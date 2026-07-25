// Translates between the V8 Chrome DevTools Protocol (CDP) spoken by clients
// of node:inspector (Chrome DevTools, vscode-js-debug, vitest --inspect, ...)
// and the JSC/WebKit inspector protocol spoken by Bun's inspector backend.
//
// One adapter instance serves one frontend connection. `handleClientMessage`
// receives raw CDP JSON from the client, `handleBackendMessage` receives raw
// JSC-protocol JSON from the backend connection. Command ids from the client
// are preserved by giving backend commands their own id space and correlating
// the responses.
const { pathToFileURL, fileURLToPath } = require("node:url");
const { isAbsolute } = require("node:path");

const EXECUTION_CONTEXT_ID = 1;

type AnyObject = Record<string, any>;

function toCdpUrl(url: string): string {
  // V8 reports filesystem-backed scripts with file:// URLs; JSC script URLs
  // are usually plain absolute paths.
  if (url && isAbsolute(url)) {
    try {
      return pathToFileURL(url).href;
    } catch {
      return url;
    }
  }
  return url;
}

// Written without a regex literal: the builtin-module bundler's scanner cannot
// parse a character class that escapes both `]` and `\`.
const REGEX_SPECIAL_CHARACTERS = "\\^$.*+?()[]{}|";
function escapeRegex(text: string): string {
  let escaped = "";
  for (const character of text) {
    escaped += REGEX_SPECIAL_CHARACTERS.includes(character) ? "\\" + character : character;
  }
  return escaped;
}

// CDP clients address scripts by file:// URL while JSC usually knows them by
// plain path, so match a breakpoint URL against every spelling.
function breakpointUrlRegex(url: string): string {
  const candidates = new Set([url]);
  if (url.startsWith("file://")) {
    try {
      candidates.$add(fileURLToPath(url));
    } catch {}
  } else if (isAbsolute(url)) {
    try {
      candidates.$add(pathToFileURL(url).href);
    } catch {}
  }
  return Array.from(candidates, candidate => `^${escapeRegex(candidate)}$`).join("|");
}

const SCOPE_TYPE_MAP: Record<string, string> = {
  global: "global",
  with: "with",
  closure: "closure",
  catch: "catch",
  functionName: "local",
  globalLexicalEnvironment: "script",
  nestedLexical: "block",
};

// No "log" entry: JSC reports console.warn/error/info/debug as
// { type: "log", level: "warning"/"error"/... }, so a type-level match on "log"
// would mask the level. #translateConsoleMessage falls through to
// CONSOLE_LEVEL_MAP for those and for console.log itself.
const CONSOLE_TYPE_MAP: Record<string, string> = {
  dir: "dir",
  dirxml: "dirxml",
  table: "table",
  trace: "trace",
  clear: "clear",
  startGroup: "startGroup",
  startGroupCollapsed: "startGroupCollapsed",
  endGroup: "endGroup",
  assert: "assert",
  timing: "timeEnd",
  profile: "profile",
  profileEnd: "profileEnd",
};

const CONSOLE_LEVEL_MAP: Record<string, string> = {
  log: "log",
  info: "info",
  warning: "warning",
  error: "error",
  debug: "debug",
};

// ── Per-session isolation ─────────────────────────────────────────────────────
// JSC's JSGlobalObjectInspectorController has a single DebuggerAgent /
// RuntimeAgent / InjectedScript, and its FrontendRouter broadcasts every
// response and event to every attached FrontendChannel. Node gives each
// inspector WebSocket a separate V8InspectorSession, so one client cannot
// disable another's Debugger, flip its breakpointsActive / pauseOnExceptions,
// delete its breakpoints, or read/release its Runtime.RemoteObject handles.
// Every adapter runs on the one debugger thread, so module-level coordination
// state needs no locking.

// Disjoint backend-command-id ranges per session: FrontendRouter replays a
// response to every channel, so without this one adapter can claim another's
// reply from its #pending map.
const BACKEND_ID_STRIDE = 1_000_000_000;

const PAUSE_ON_EXCEPTIONS_ORDER: Record<string, number> = {
  __proto__: null as never,
  none: 0,
  uncaught: 1,
  all: 2,
};

// V8's message when a session asks about a RemoteObject it never received.
const FOREIGN_OBJECT_ID_ERROR = "Could not find object with given id";

let nextSessionId = 1;
// A Map (not a Set) so we can reach other adapters' sendToBackend for backend
// aggregate updates even after an adapter has left.
const liveAdapters: Map<number, InspectorCDPAdapter> = new Map();

type SessionFlags = {
  debuggerEnabled: boolean;
  runtimeEnabled: boolean;
  breakpointsActive: boolean;
  pauseOnExceptions: string;
};

const sessionFlags: Map<number, SessionFlags> = new Map();
const breakpointOwner: Map<string, number> = new Map();
// Last values actually sent to the single backend so we only write on change.
const backendAggregate = { breakpointsActive: false, pauseOnExceptions: "none" };

function aggregateBreakpointsActive(): boolean {
  for (const flags of sessionFlags.values()) {
    if (flags.debuggerEnabled && flags.breakpointsActive) return true;
  }
  return false;
}

function aggregatePauseOnExceptions(): string {
  let best = "none";
  let bestRank = 0;
  for (const flags of sessionFlags.values()) {
    if (!flags.debuggerEnabled) continue;
    const rank = PAUSE_ON_EXCEPTIONS_ORDER[flags.pauseOnExceptions] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = flags.pauseOnExceptions;
    }
  }
  return best;
}

function anyDebuggerEnabled(): boolean {
  for (const flags of sessionFlags.values()) if (flags.debuggerEnabled) return true;
  return false;
}

function anyRuntimeEnabled(): boolean {
  for (const flags of sessionFlags.values()) if (flags.runtimeEnabled) return true;
  return false;
}

// Tag every RemoteObject handle leaving this adapter with its session id so a
// handle minted for one client cannot be presented by another. JSC emits a
// fixed `{"injectedScriptId":N,"id":M}` string (InjectedScriptSource.js), so a
// recursive walk that rewrites every `objectId` string property covers
// evaluate/callFunctionOn/getProperties results, paused scope chains and
// consoleAPICalled args alike.
function tagObjectIds(value: unknown, sessionId: number): void {
  if (value === null || typeof value !== "object") return;
  if ($isArray(value)) {
    for (let i = 0; i < (value as unknown[]).length; i++) tagObjectIds((value as unknown[])[i], sessionId);
    return;
  }
  const obj = value as AnyObject;
  for (const key in obj) {
    const child = obj[key];
    if (key === "objectId" && typeof child === "string" && child.charCodeAt(0) === 123 /* '{' */) {
      obj[key] = `{"bunSessionId":${sessionId},${child.slice(1)}`;
    } else if (child !== null && typeof child === "object") {
      tagObjectIds(child, sessionId);
    }
  }
}

// Inverse of tagObjectIds for a single id string: returns the backend id when
// the tag matches this session, or null when it belongs to another (or has no
// tag, i.e. a client guessing raw backend ids).
function untagObjectId(objectId: unknown, sessionId: number): string | null {
  if (typeof objectId !== "string") return null;
  let parsed: AnyObject;
  try {
    parsed = JSON.parse(objectId);
  } catch {
    return null;
  }
  if (parsed?.bunSessionId !== sessionId) return null;
  const { bunSessionId: _bunSessionId, ...rest } = parsed;
  return JSON.stringify(rest);
}

class InspectorCDPAdapter {
  #writeToBackend: (message: string) => void;
  #writeToClient: (message: string) => void;
  #sessionId: number;
  #nextBackendId: number;
  #nextExceptionId = 1;
  #pending = new Map<
    number,
    { clientId: number | string | null; method: string; onResult?: (result: AnyObject, error?: AnyObject) => void }
  >();
  #scripts = new Map<string, { cdpUrl: string; endLine: number; endColumn: number }>();
  #flags: SessionFlags;

  constructor(writeToBackend: (message: string) => void, writeToClient: (message: string) => void) {
    this.#writeToBackend = writeToBackend;
    this.#writeToClient = writeToClient;
    this.#sessionId = nextSessionId++;
    this.#nextBackendId = this.#sessionId * BACKEND_ID_STRIDE;
    this.#flags = { debuggerEnabled: false, runtimeEnabled: false, breakpointsActive: true, pauseOnExceptions: "none" };
    sessionFlags.$set(this.#sessionId, this.#flags);
    liveAdapters.$set(this.#sessionId, this);
  }

  handleClientMessage(message: string): void {
    let parsed: AnyObject;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== "object") return;
    const { id, method, params } = parsed;
    if (typeof method !== "string") return;
    try {
      this.#dispatchClientCommand(id, method, params || {});
    } catch (error) {
      this.#replyErrorToClient(id, -32000, `${error}`);
    }
  }

  handleBackendMessage(message: string): void {
    let parsed: AnyObject;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const { id, error, method } = parsed;
    if (id !== undefined) {
      const pending = this.#pending.$get(id);
      if (!pending) return;
      this.#pending.$delete(id);
      const { clientId, onResult } = pending;
      const result = parsed.result || {};
      tagObjectIds(result, this.#sessionId);
      if (onResult) {
        onResult(result, error);
        return;
      }
      if (clientId === null || clientId === undefined) return;
      if (error) {
        this.#replyErrorToClient(clientId, error.code ?? -32000, error.message ?? "Unknown error");
        return;
      }
      this.#replyToClient(clientId, this.#translateResult(pending.method, result));
      return;
    }
    if (typeof method === "string") {
      this.#translateBackendEvent(method, parsed.params || {});
    }
  }

  // Drop this session's contribution to the shared backend state. Called when
  // the WebSocket closes so a vanished client cannot keep breakpoints armed or
  // hold Debugger enabled for everyone else.
  dispose(): void {
    if (!liveAdapters.$has(this.#sessionId)) return;
    this.#teardownDebuggerState();
    if (this.#flags.runtimeEnabled) {
      this.#flags.runtimeEnabled = false;
      if (!anyRuntimeEnabled()) {
        this.#sendToBackend("Runtime.disable");
        this.#sendToBackend("Console.disable");
      }
    }
    sessionFlags.$delete(this.#sessionId);
    liveAdapters.$delete(this.#sessionId);
  }

  // Any live adapter can deliver aggregate updates to the single backend.
  static #backendWriter(): InspectorCDPAdapter | undefined {
    for (const adapter of liveAdapters.values()) return adapter;
    return undefined;
  }

  #syncBackendAggregate(): void {
    const active = aggregateBreakpointsActive();
    if (active !== backendAggregate.breakpointsActive) {
      backendAggregate.breakpointsActive = active;
      const writer = InspectorCDPAdapter.#backendWriter() ?? this;
      writer.#sendToBackend("Debugger.setBreakpointsActive", { active });
    }
    const pauseState = aggregatePauseOnExceptions();
    if (pauseState !== backendAggregate.pauseOnExceptions) {
      backendAggregate.pauseOnExceptions = pauseState;
      const writer = InspectorCDPAdapter.#backendWriter() ?? this;
      writer.#sendToBackend("Debugger.setPauseOnExceptions", { state: pauseState });
    }
  }

  #teardownDebuggerState(): void {
    if (!this.#flags.debuggerEnabled) return;
    const owned: string[] = [];
    for (const [breakpointId, owner] of breakpointOwner) {
      if (owner === this.#sessionId) owned.push(breakpointId);
    }
    for (const breakpointId of owned) {
      breakpointOwner.$delete(breakpointId);
      this.#sendToBackend("Debugger.removeBreakpoint", { breakpointId });
    }
    this.#flags.debuggerEnabled = false;
    this.#flags.breakpointsActive = true;
    this.#flags.pauseOnExceptions = "none";
    this.#syncBackendAggregate();
    if (!anyDebuggerEnabled()) this.#sendToBackend("Debugger.disable");
  }

  #replyToClient(id: number | string, result: AnyObject): void {
    this.#writeToClient(JSON.stringify({ id, result }));
  }

  #replyErrorToClient(id: number | string, code: number, message: string): void {
    this.#writeToClient(JSON.stringify({ id, error: { code, message } }));
  }

  #emitToClient(method: string, params: AnyObject): void {
    this.#writeToClient(JSON.stringify({ method, params }));
  }

  // `clientId` undefined/null marks an adapter-internal command whose response
  // is dropped instead of being forwarded to the client. `onResult` intercepts
  // the response for adapter-side chaining (e.g. Runtime.evaluate awaitPromise).
  #sendToBackend(
    method: string,
    params?: AnyObject,
    clientId: number | string | null = null,
    clientMethod = method,
    onResult?: (result: AnyObject, error?: AnyObject) => void,
  ): void {
    const id = this.#nextBackendId++;
    this.#pending.$set(id, { clientId, method: clientMethod, onResult });
    this.#writeToBackend(JSON.stringify(params === undefined ? { id, method } : { id, method, params }));
  }

  #dispatchClientCommand(id: number | string, method: string, params: AnyObject): void {
    switch (method) {
      // ── Runtime ──────────────────────────────────────────────────────────
      case "Runtime.enable":
        this.#flags.runtimeEnabled = true;
        // JSGlobalObject inspection has a single execution context; CDP clients
        // need at least one announced for the console and evaluation to work.
        this.#emitToClient("Runtime.executionContextCreated", {
          context: {
            id: EXECUTION_CONTEXT_ID,
            origin: "",
            name: "Bun",
            uniqueId: String(EXECUTION_CONTEXT_ID),
          },
        });
        this.#sendToBackend("Runtime.enable");
        // Console output arrives as Console.messageAdded and is re-emitted as
        // Runtime.consoleAPICalled. Answer the client from this one for the
        // same reason as Debugger.enable below: a client that runs code once
        // Runtime.enable resolves expects console events to be flowing.
        this.#sendToBackend("Console.enable", undefined, id, method);
        return;

      case "Runtime.disable":
        this.#flags.runtimeEnabled = false;
        if (anyRuntimeEnabled()) {
          // Another session still wants console events; keep the shared
          // Console agent alive and just stop forwarding to this client.
          this.#replyToClient(id, {});
          return;
        }
        this.#sendToBackend("Runtime.disable");
        // Runtime.enable also enabled the Console domain; mirror it here so a
        // client that disables Runtime stops receiving consoleAPICalled.
        this.#sendToBackend("Console.disable", undefined, id, method);
        return;

      case "Runtime.runIfWaitingForDebugger":
        // Inspector.initialized resolves Bun's wait-for-debugger state, which
        // unblocks inspector.open(port, host, true) on the inspected thread.
        this.#sendToBackend("Inspector.initialized");
        this.#replyToClient(id, {});
        return;

      case "Runtime.evaluate": {
        // JSC's JSGlobalObjectRuntimeAgent rejects any contextId ("only one
        // execution context"), so drop it even though CDP clients echo it.
        const jscParams = {
          expression: params.expression,
          objectGroup: params.objectGroup,
          includeCommandLineAPI: params.includeCommandLineAPI,
          doNotPauseOnExceptionsAndMuteConsole: params.silent,
          returnByValue: params.returnByValue,
          generatePreview: params.generatePreview,
          emulateUserGesture: params.userGesture,
        };
        // JSC has no `awaitPromise` on Runtime.evaluate; emulate it by
        // chaining Runtime.awaitPromise when the result is a promise. The
        // initial evaluate must not use returnByValue (it would serialize the
        // Promise itself instead of returning the objectId to await on).
        if (params.awaitPromise === true) {
          const firstStep = { ...jscParams, returnByValue: false };
          this.#sendToBackend("Runtime.evaluate", firstStep, null, method, (result, error) => {
            if (error) {
              this.#replyErrorToClient(id, error.code ?? -32000, error.message ?? "Unknown error");
              return;
            }
            const remote = result.result;
            const objectId = untagObjectId(remote?.objectId, this.#sessionId);
            if (!result.wasThrown && remote?.type === "object" && objectId) {
              // JSC's Runtime.awaitPromise resolves any thenable and returns
              // non-thenable objects as-is, so no subtype check is needed.
              this.#sendToBackend(
                "Runtime.awaitPromise",
                {
                  promiseObjectId: objectId,
                  returnByValue: params.returnByValue,
                  generatePreview: params.generatePreview,
                  saveResult: params.saveResult,
                },
                id,
                method,
              );
              return;
            }
            // Primitive / thrown: nothing to await. Primitives already carry
            // value regardless of returnByValue; a thrown non-primitive comes
            // back as an objectId (the first step forced returnByValue:false),
            // which DevTools/vscode-js-debug inspect via exceptionDetails, so
            // we do not re-serialize it to honour the client's returnByValue.
            this.#replyToClient(id, this.#translateResult(method, result));
          });
          return;
        }
        this.#sendToBackend("Runtime.evaluate", jscParams, id, method);
        return;
      }

      case "Runtime.getProperties": {
        if (params.accessorPropertiesOnly) {
          // JSC has no accessor-only query; DevTools issues this in addition to
          // the regular request, so an empty list keeps the merged view correct.
          this.#replyToClient(id, { result: [] });
          return;
        }
        const backendObjectId = untagObjectId(params.objectId, this.#sessionId);
        if (backendObjectId === null) {
          this.#replyErrorToClient(id, -32000, FOREIGN_OBJECT_ID_ERROR);
          return;
        }
        this.#sendToBackend(
          "Runtime.getProperties",
          {
            objectId: backendObjectId,
            ownProperties: params.ownProperties,
            generatePreview: params.generatePreview,
          },
          id,
          method,
        );
        return;
      }

      case "Runtime.callFunctionOn": {
        const { objectId, executionContextId } = params;
        let callArguments = params.arguments;
        if ($isArray(callArguments)) {
          callArguments = callArguments.map((arg: AnyObject) => {
            if (arg === null || typeof arg !== "object") return arg;
            const { objectId: argObjectId } = arg;
            if (typeof argObjectId !== "string") return arg;
            const backendArgId = untagObjectId(argObjectId, this.#sessionId);
            return backendArgId === null ? arg : { ...arg, objectId: backendArgId };
          });
        }
        const forward = (targetObjectId: unknown) =>
          this.#sendToBackend(
            "Runtime.callFunctionOn",
            {
              objectId: targetObjectId,
              functionDeclaration: params.functionDeclaration,
              arguments: callArguments,
              doNotPauseOnExceptionsAndMuteConsole: params.silent,
              returnByValue: params.returnByValue,
              generatePreview: params.generatePreview,
              emulateUserGesture: params.userGesture,
              awaitPromise: params.awaitPromise,
            },
            id,
            method,
          );
        if (objectId) {
          const backendObjectId = untagObjectId(objectId, this.#sessionId);
          if (backendObjectId === null) {
            this.#replyErrorToClient(id, -32000, FOREIGN_OBJECT_ID_ERROR);
            return;
          }
          forward(backendObjectId);
          return;
        }
        if (executionContextId === undefined) {
          this.#replyErrorToClient(id, -32602, "Either objectId or executionContextId must be specified");
          return;
        }
        // CDP allows executionContextId-only (calls with this === globalThis);
        // JSC requires an objectId, so fetch the global's first. JSC has a
        // single execution context and rejects contextId, so omit it. Pass the
        // client's objectGroup so its releaseObjectGroup reclaims this handle.
        this.#sendToBackend(
          "Runtime.evaluate",
          { expression: "globalThis", objectGroup: params.objectGroup },
          null,
          method,
          (result, error) => {
            const globalObjectId = untagObjectId(result.result?.objectId, this.#sessionId);
            if (error || !globalObjectId) {
              this.#replyErrorToClient(id, error?.code ?? -32000, error?.message ?? "Failed to resolve global object");
              return;
            }
            forward(globalObjectId);
          },
        );
        return;
      }

      case "Runtime.releaseObject": {
        const backendObjectId = untagObjectId(params.objectId, this.#sessionId);
        if (backendObjectId === null) {
          this.#replyErrorToClient(id, -32000, FOREIGN_OBJECT_ID_ERROR);
          return;
        }
        this.#sendToBackend(method, { objectId: backendObjectId }, id, method);
        return;
      }

      case "Runtime.releaseObjectGroup":
        this.#sendToBackend(method, params, id, method);
        return;

      case "Runtime.getIsolateId":
        this.#replyToClient(id, { id: "bun" });
        return;

      case "Runtime.getHeapUsage":
        this.#replyToClient(id, { usedSize: 0, totalSize: 0 });
        return;

      case "Runtime.compileScript":
        this.#replyToClient(id, {});
        return;

      case "Runtime.globalLexicalScopeNames":
        this.#replyToClient(id, { names: [] });
        return;

      // ── Debugger ─────────────────────────────────────────────────────────
      case "Debugger.enable":
        this.#flags.debuggerEnabled = true;
        this.#flags.breakpointsActive = true;
        // The shared agent is idempotent and re-broadcasts scriptParsed on
        // each enable, so a late-joining client still receives the script list.
        this.#sendToBackend("Debugger.enable");
        // V8's Debugger.enable activates breakpoints and pauses on `debugger;`
        // by default; JSC requires explicit opt-in for both. A client may run
        // code as soon as it sees the Debugger.enable response and expects
        // pausing to already be armed, so answer it from the last of the three
        // commands instead of the first: the backend replies in order, so that
        // response is proof all three landed. #translateResult still builds
        // V8's { debuggerId } shape from the clientMethod passed here.
        backendAggregate.breakpointsActive = true;
        this.#sendToBackend("Debugger.setBreakpointsActive", { active: true });
        this.#sendToBackend("Debugger.setPauseOnDebuggerStatements", { enabled: true }, id, method);
        return;

      case "Debugger.disable":
        this.#teardownDebuggerState();
        this.#replyToClient(id, {});
        return;

      case "Debugger.setBreakpointsActive":
        this.#flags.breakpointsActive = params.active !== false;
        this.#syncBackendAggregate();
        this.#replyToClient(id, {});
        return;

      case "Debugger.setPauseOnExceptions": {
        const state = params.state === "caught" ? "all" : typeof params.state === "string" ? params.state : "none";
        this.#flags.pauseOnExceptions = state;
        this.#syncBackendAggregate();
        this.#replyToClient(id, {});
        return;
      }

      case "Debugger.removeBreakpoint": {
        const { breakpointId } = params;
        const owner = breakpointOwner.$get(breakpointId);
        if (owner !== undefined && owner !== this.#sessionId) {
          // V8's per-session breakpoint store would have no entry here.
          this.#replyToClient(id, {});
          return;
        }
        breakpointOwner.$delete(breakpointId);
        this.#sendToBackend(method, params, id, method);
        return;
      }

      case "Debugger.pause":
      case "Debugger.resume":
      case "Debugger.stepInto":
      case "Debugger.stepOut":
      case "Debugger.stepOver":
      case "Debugger.continueToLocation":
      case "Debugger.getScriptSource":
        this.#sendToBackend(method, params, id, method);
        return;

      case "Debugger.setAsyncCallStackDepth":
        this.#sendToBackend("Debugger.setAsyncStackTraceDepth", { depth: params.maxDepth ?? 0 }, id, method);
        return;

      case "Debugger.setBreakpointByUrl": {
        const { condition, urlRegex, url } = params;
        const options: AnyObject = {};
        if (condition) options.condition = condition;
        const jscParams: AnyObject = {
          lineNumber: params.lineNumber,
          columnNumber: params.columnNumber,
          options,
        };
        if (urlRegex) {
          jscParams.urlRegex = urlRegex;
        } else if (url) {
          jscParams.urlRegex = breakpointUrlRegex(url);
        } else if (params.scriptHash) {
          // CDP also accepts scriptHash; JSC has no content-hash addressing
          // (Debugger.scriptParsed carries no hash to match against).
          this.#replyErrorToClient(id, -32000, "scriptHash breakpoints are not supported");
          return;
        } else {
          this.#replyErrorToClient(id, -32602, "Either url or urlRegex must be specified.");
          return;
        }
        this.#sendToBackend("Debugger.setBreakpointByUrl", jscParams, null, method, (result, error) =>
          this.#forwardBreakpointResult(id, method, result, error),
        );
        return;
      }

      case "Debugger.setBreakpoint": {
        const { condition } = params;
        this.#sendToBackend(
          "Debugger.setBreakpoint",
          {
            location: params.location,
            options: condition ? { condition } : undefined,
          },
          null,
          method,
          (result, error) => this.#forwardBreakpointResult(id, method, result, error),
        );
        return;
      }

      case "Debugger.getPossibleBreakpoints": {
        const start = params.start;
        let end = params.end;
        if (!end) {
          const script = this.#scripts.$get(start?.scriptId);
          end = {
            scriptId: start?.scriptId,
            lineNumber: script ? script.endLine : (start?.lineNumber ?? 0) + 1,
            columnNumber: script ? script.endColumn : 0,
          };
        }
        this.#sendToBackend("Debugger.getBreakpointLocations", { start, end }, id, method);
        return;
      }

      case "Debugger.evaluateOnCallFrame":
        this.#sendToBackend(
          "Debugger.evaluateOnCallFrame",
          {
            callFrameId: params.callFrameId,
            expression: params.expression,
            objectGroup: params.objectGroup,
            includeCommandLineAPI: params.includeCommandLineAPI,
            doNotPauseOnExceptionsAndMuteConsole: params.silent,
            returnByValue: params.returnByValue,
            generatePreview: params.generatePreview,
          },
          id,
          method,
        );
        return;

      case "HeapProfiler.collectGarbage":
        this.#sendToBackend("Heap.gc", undefined, id, method);
        return;

      case "Console.enable":
      case "Console.disable":
      case "Console.clearMessages":
      case "Inspector.enable":
        this.#sendToBackend(method, undefined, id, method);
        return;

      // Accepted but inert: CDP features JSC's inspector does not implement and
      // that do not affect core debugging.
      case "Debugger.setSkipAllPauses":
      case "Debugger.setBlackboxPatterns":
      case "Debugger.setBlackboxExecutionContexts":
      case "Debugger.setInstrumentationBreakpoint":
      case "Debugger.removeInstrumentationBreakpoint":
      case "Runtime.addBinding":
      case "Runtime.removeBinding":
      case "Runtime.setMaxCallStackSizeToCapture":
      case "Runtime.discardConsoleEntries":
      case "Runtime.setCustomObjectFormatterEnabled":
      case "Runtime.setAsyncCallStackDepth":
      case "Profiler.enable":
      case "Profiler.disable":
      case "HeapProfiler.enable":
      case "HeapProfiler.disable":
      case "Network.enable":
      case "Network.disable":
      case "Log.enable":
      case "Log.disable":
      case "Log.clear":
      case "Page.enable":
      case "Target.setAutoAttach":
      case "Target.setDiscoverTargets":
      case "Target.setRemoteLocations":
      case "NodeWorker.enable":
      case "NodeWorker.disable":
      case "NodeRuntime.enable":
      case "NodeRuntime.disable":
      case "NodeRuntime.notifyWhenWaitingForDisconnect":
        this.#replyToClient(id, {});
        return;

      default:
        this.#replyErrorToClient(id, -32601, `'${method}' wasn't found`);
    }
  }

  #forwardBreakpointResult(id: number | string, method: string, result: AnyObject, error?: AnyObject): void {
    if (error) {
      this.#replyErrorToClient(id, error.code ?? -32000, error.message ?? "Unknown error");
      return;
    }
    const { breakpointId } = result;
    if (typeof breakpointId === "string") breakpointOwner.$set(breakpointId, this.#sessionId);
    this.#replyToClient(id, this.#translateResult(method, result));
  }

  #translateResult(method: string, result: AnyObject): AnyObject {
    switch (method) {
      case "Debugger.enable":
        return { debuggerId: "(bun)", ...result };

      case "Runtime.evaluate":
      case "Runtime.callFunctionOn":
      case "Debugger.evaluateOnCallFrame": {
        const out: AnyObject = { result: result.result ?? { type: "undefined" } };
        if (result.wasThrown) {
          out.exceptionDetails = {
            exceptionId: this.#nextExceptionId++,
            text: result.result?.description ?? "Uncaught",
            lineNumber: 0,
            columnNumber: 0,
            exception: result.result,
          };
        }
        return out;
      }

      case "Runtime.getProperties": {
        const properties = (result.properties ?? []).map((property: AnyObject) => ({
          configurable: false,
          enumerable: false,
          ...property,
        }));
        const out: AnyObject = { result: properties };
        const { internalProperties } = result;
        if (internalProperties) out.internalProperties = internalProperties;
        return out;
      }

      case "Debugger.getPossibleBreakpoints":
        return { locations: result.locations ?? [] };

      default:
        return result;
    }
  }

  #translateBackendEvent(method: string, params: AnyObject): void {
    // FrontendRouter broadcasts every event to every channel; only forward the
    // ones this session opted into, so a never-enabled client cannot observe
    // another's Debugger.paused frames or console output.
    if (method.charCodeAt(0) === 68 /* 'D' */ && method.startsWith("Debugger.")) {
      if (!this.#flags.debuggerEnabled) return;
    } else if (method === "Console.messageAdded") {
      if (!this.#flags.runtimeEnabled) return;
    }
    switch (method) {
      case "Debugger.scriptParsed": {
        const url = params.sourceURL || params.url || "";
        const cdpUrl = toCdpUrl(url);
        this.#scripts.$set(params.scriptId, {
          cdpUrl,
          endLine: params.endLine ?? 0,
          endColumn: params.endColumn ?? 0,
        });
        this.#emitToClient("Debugger.scriptParsed", {
          scriptId: params.scriptId,
          url: cdpUrl,
          startLine: params.startLine ?? 0,
          startColumn: params.startColumn ?? 0,
          endLine: params.endLine ?? 0,
          endColumn: params.endColumn ?? 0,
          executionContextId: EXECUTION_CONTEXT_ID,
          hash: "",
          isModule: !!params.module,
          sourceMapURL: params.sourceMapURL,
          embedderName: cdpUrl,
          scriptLanguage: "JavaScript",
        });
        return;
      }

      case "Debugger.paused": {
        tagObjectIds(params, this.#sessionId);
        const callFrames = (params.callFrames ?? []).map((frame: AnyObject) => ({
          callFrameId: frame.callFrameId,
          functionName: frame.functionName ?? "",
          location: frame.location,
          url: this.#scripts.$get(frame.location?.scriptId)?.cdpUrl ?? "",
          scopeChain: (frame.scopeChain ?? []).map((scope: AnyObject) => ({
            type: SCOPE_TYPE_MAP[scope.type] ?? "closure",
            object: scope.object,
            name: scope.name,
          })),
          this: frame.this,
          canBeRestarted: false,
        }));
        const { data, asyncStackTrace } = params;
        const cdpParams: AnyObject = { callFrames, reason: "other", data };
        switch (params.reason) {
          case "exception":
            cdpParams.reason = "exception";
            break;
          case "assert":
            cdpParams.reason = "assert";
            break;
          case "Breakpoint":
            if (data?.breakpointId) cdpParams.hitBreakpoints = [data.breakpointId];
            break;
        }
        if (asyncStackTrace) cdpParams.asyncStackTrace = this.#translateStackTrace(asyncStackTrace);
        this.#emitToClient("Debugger.paused", cdpParams);
        return;
      }

      case "Debugger.resumed":
        this.#emitToClient("Debugger.resumed", {});
        return;

      case "Debugger.breakpointResolved":
        this.#emitToClient("Debugger.breakpointResolved", {
          breakpointId: params.breakpointId,
          location: params.location,
        });
        return;

      case "Debugger.globalObjectCleared":
        this.#emitToClient("Runtime.executionContextsCleared", {});
        return;

      case "Console.messageAdded":
        tagObjectIds(params, this.#sessionId);
        this.#translateConsoleMessage(params.message || {});
        return;

      default:
        // JSC- and Bun-specific events have no CDP equivalent.
        return;
    }
  }

  #translateStackTrace(stackTrace: AnyObject | undefined): AnyObject | undefined {
    if (!stackTrace) return undefined;
    const translated: AnyObject = {
      callFrames: (stackTrace.callFrames ?? []).map((frame: AnyObject) => ({
        functionName: frame.functionName ?? "",
        scriptId: frame.scriptId ?? "",
        url: toCdpUrl(frame.url ?? ""),
        lineNumber: frame.lineNumber ?? 0,
        columnNumber: frame.columnNumber ?? 0,
      })),
    };
    const { parentStackTrace } = stackTrace;
    if (parentStackTrace) {
      translated.parent = this.#translateStackTrace(parentStackTrace);
    }
    return translated;
  }

  #translateConsoleMessage(message: AnyObject): void {
    const level = message.level ?? "log";
    const args = message.parameters?.length ? message.parameters : [{ type: "string", value: message.text ?? "" }];

    if (message.source !== "console-api" && level === "error") {
      this.#emitToClient("Runtime.exceptionThrown", {
        timestamp: message.timestamp ?? Date.now(),
        exceptionDetails: {
          exceptionId: this.#nextExceptionId++,
          text: message.text ?? "Uncaught",
          lineNumber: Math.max((message.line ?? 1) - 1, 0),
          columnNumber: Math.max((message.column ?? 1) - 1, 0),
          url: toCdpUrl(message.url ?? ""),
          stackTrace: this.#translateStackTrace(message.stackTrace),
        },
      });
      return;
    }

    const type =
      message.type && CONSOLE_TYPE_MAP[message.type]
        ? CONSOLE_TYPE_MAP[message.type]
        : (CONSOLE_LEVEL_MAP[level] ?? "log");
    this.#emitToClient("Runtime.consoleAPICalled", {
      type,
      args,
      executionContextId: EXECUTION_CONTEXT_ID,
      timestamp: message.timestamp ?? Date.now(),
      stackTrace: this.#translateStackTrace(message.stackTrace),
    });
  }
}

export default {
  InspectorCDPAdapter,
  EXECUTION_CONTEXT_ID,
};
