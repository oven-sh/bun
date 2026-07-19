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

class InspectorCDPAdapter {
  #writeToBackend: (message: string) => void;
  #writeToClient: (message: string) => void;
  #nextBackendId = 1;
  #nextExceptionId = 1;
  #pending = new Map<
    number,
    { clientId: number | string | null; method: string; onResult?: (result: AnyObject, error?: AnyObject) => void }
  >();
  #scripts = new Map<string, { cdpUrl: string; endLine: number; endColumn: number }>();
  // NodeRuntime domain state, per connection, mirroring Node's RuntimeAgent.
  #nodeRuntimeEnabled = false;
  #isWaitingForDebugger: () => boolean;

  constructor(
    writeToBackend: (message: string) => void,
    writeToClient: (message: string) => void,
    isWaitingForDebugger: () => boolean = () => false,
  ) {
    this.#writeToBackend = writeToBackend;
    this.#writeToClient = writeToClient;
    this.#isWaitingForDebugger = isWaitingForDebugger;
  }

  handleClientMessage(message: string): void {
    let parsed: AnyObject;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
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
      if (onResult) {
        onResult(parsed.result || {}, error);
        return;
      }
      if (clientId === null || clientId === undefined) return;
      if (error) {
        this.#replyErrorToClient(clientId, error.code ?? -32000, error.message ?? "Unknown error");
        return;
      }
      this.#replyToClient(clientId, this.#translateResult(pending.method, parsed.result || {}));
      return;
    }
    if (typeof method === "string") {
      this.#translateBackendEvent(method, parsed.params || {});
    }
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
            const objectId = remote?.objectId;
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
            // Primitive / thrown: nothing to await; primitives already carry
            // value regardless of returnByValue.
            this.#replyToClient(id, this.#translateResult(method, result));
          });
          return;
        }
        this.#sendToBackend("Runtime.evaluate", jscParams, id, method);
        return;
      }

      case "Runtime.getProperties":
        if (params.accessorPropertiesOnly) {
          // JSC has no accessor-only query; DevTools issues this in addition to
          // the regular request, so an empty list keeps the merged view correct.
          this.#replyToClient(id, { result: [] });
          return;
        }
        this.#sendToBackend(
          "Runtime.getProperties",
          {
            objectId: params.objectId,
            ownProperties: params.ownProperties,
            generatePreview: params.generatePreview,
          },
          id,
          method,
        );
        return;

      case "Runtime.callFunctionOn": {
        const { objectId, executionContextId } = params;
        const forward = (targetObjectId: unknown) =>
          this.#sendToBackend(
            "Runtime.callFunctionOn",
            {
              objectId: targetObjectId,
              functionDeclaration: params.functionDeclaration,
              arguments: params.arguments,
              doNotPauseOnExceptionsAndMuteConsole: params.silent,
              returnByValue: params.returnByValue,
              generatePreview: params.generatePreview,
              awaitPromise: params.awaitPromise,
            },
            id,
            method,
          );
        if (objectId) {
          forward(objectId);
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
            const globalObjectId = result.result?.objectId;
            if (error || !globalObjectId) {
              this.#replyErrorToClient(id, error?.code ?? -32000, error?.message ?? "Failed to resolve global object");
              return;
            }
            forward(globalObjectId);
          },
        );
        return;
      }

      case "Runtime.releaseObject":
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
        this.#sendToBackend("Debugger.enable");
        // V8's Debugger.enable activates breakpoints and pauses on `debugger;`
        // by default; JSC requires explicit opt-in for both. A client may run
        // code as soon as it sees the Debugger.enable response and expects
        // pausing to already be armed, so answer it from the last of the three
        // commands instead of the first: the backend replies in order, so that
        // response is proof all three landed. #translateResult still builds
        // V8's { debuggerId } shape from the clientMethod passed here.
        this.#sendToBackend("Debugger.setBreakpointsActive", { active: true });
        this.#sendToBackend("Debugger.setPauseOnDebuggerStatements", { enabled: true }, id, method);
        return;

      case "Debugger.disable":
      case "Debugger.pause":
      case "Debugger.resume":
      case "Debugger.stepInto":
      case "Debugger.stepOut":
      case "Debugger.stepOver":
      case "Debugger.setBreakpointsActive":
      case "Debugger.removeBreakpoint":
      case "Debugger.continueToLocation":
      case "Debugger.getScriptSource":
        this.#sendToBackend(method, params, id, method);
        return;

      case "Debugger.setPauseOnExceptions":
        this.#sendToBackend(
          "Debugger.setPauseOnExceptions",
          { state: params.state === "caught" ? "all" : params.state },
          id,
          method,
        );
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
        } else {
          this.#replyErrorToClient(id, -32602, "Either url or urlRegex must be specified.");
          return;
        }
        this.#sendToBackend("Debugger.setBreakpointByUrl", jscParams, id, method);
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
          id,
          method,
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
      // Accepted and ignored: JSC's sampling interval is not configurable.
      // Nothing can observe the difference, since Profiler.start has no
      // translation and is rejected as unknown.
      case "Profiler.setSamplingInterval":
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
      case "NodeRuntime.notifyWhenWaitingForDisconnect":
        this.#replyToClient(id, {});
        return;

      case "NodeRuntime.enable":
        // Node's RuntimeAgent::enable announces the wait, if there is one,
        // before the reply, and does so again on every re-enable. Clients
        // (--inspect-brk launchers, Node's own test helper) block on it.
        this.#nodeRuntimeEnabled = true;
        if (this.#isWaitingForDebugger()) {
          this.#emitToClient("NodeRuntime.waitingForDebugger", {});
        }
        this.#replyToClient(id, {});
        return;

      case "NodeRuntime.disable":
        this.#nodeRuntimeEnabled = false;
        this.#replyToClient(id, {});
        return;

      default:
        this.#replyErrorToClient(id, -32601, `'${method}' wasn't found`);
    }
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
        this.#translateConsoleMessage(params.message || {});
        return;

      case "Bun.waitingForDebugger":
        // Synthesized by the inspected thread when it starts waiting for a
        // frontend, mirroring Node's RuntimeAgent::setWaitingForDebugger:
        // announce it to a session that already enabled the domain.
        if (this.#nodeRuntimeEnabled) {
          this.#emitToClient("NodeRuntime.waitingForDebugger", {});
        }
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
