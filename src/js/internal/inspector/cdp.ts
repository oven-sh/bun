// Translates V8 CDP (https://chromedevtools.github.io/devtools-protocol/) to/from the JSC inspector
// protocol (https://github.com/WebKit/WebKit/tree/main/Source/JavaScriptCore/inspector/protocol).
// One adapter per frontend connection; backend commands use a separate id space.
const { pathToFileURL, fileURLToPath } = require("node:url");
const { SafeMap, SafeSet } = require("internal/primordials");
const { Buffer } = require("node:buffer");
const { basename, isAbsolute } = require("node:path");

const EXECUTION_CONTEXT_ID = 1;
const PSEUDO_SCRIPT_NAMES = new Set(["[eval]", "[stdin]"]);

type AnyObject = Record<string, any>;

function toCdpUrl(url: string): string {
  // V8 reports filesystem-backed scripts with file:// URLs; JSC script URLs
  // are usually plain absolute paths.
  if (url && isAbsolute(url)) {
    const base = basename(url);
    if (PSEUDO_SCRIPT_NAMES.$has(base)) {
      return base;
    }
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
  if (PSEUDO_SCRIPT_NAMES.$has(url)) {
    return [`${escapeRegex("/" + url)}$`, `${escapeRegex("\\" + url)}$`, `^${escapeRegex(url)}$`].join("|");
  }
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

// ── Source maps ────────────────────────────────────────────────────────────

interface OriginalPosition {
  lineNumber: number;
  columnNumber: number;
}

interface GeneratedLine {
  columns: number[];
  lineNumbers: number[];
  columnNumbers: number[];
}

interface ScriptSourceMap {
  byGeneratedLine: (GeneratedLine | undefined)[];
  originalOrder: { lineNumber: number; columnNumber: number; genLine: number; genColumn: number }[];
}

interface ScriptRecord {
  cdpUrl: string;
  endLine: number;
  endColumn: number;
  source: string | undefined;
  mappings: string | undefined;
  map: ScriptSourceMap | undefined;
}

const VLQ_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_VALUES = new Map<string, number>();
for (let index = 0; index < VLQ_CHARACTERS.length; index++) {
  VLQ_VALUES.$set(VLQ_CHARACTERS[index], index);
}

function decodeSourceMapURL(sourceMapURL: string | undefined): AnyObject | undefined {
  if (!sourceMapURL || !sourceMapURL.startsWith("data:application/json")) return undefined;
  const comma = sourceMapURL.indexOf(",");
  if (comma < 0) return undefined;
  try {
    const payload = sourceMapURL.slice(comma + 1);
    const text = sourceMapURL.slice(0, comma).endsWith(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    const map = JSON.parse(text);
    if (!map || typeof map.mappings !== "string") return undefined;
    if (!$isJSArray(map.sources) || map.sources.length !== 1) return undefined;
    return map;
  } catch {
    return undefined;
  }
}

function decodeMappings(mappings: string): ScriptSourceMap {
  const byGeneratedLine: (GeneratedLine | undefined)[] = [];
  const originalOrder: ScriptSourceMap["originalOrder"] = [];
  let genLine = 0;
  let genColumn = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let index = 0;
  const length = mappings.length;

  while (index < length) {
    const character = mappings[index];
    if (character === ";") {
      genLine++;
      genColumn = 0;
      index++;
      continue;
    }
    if (character === ",") {
      index++;
      continue;
    }
    const fields: number[] = [];
    while (index < length && mappings[index] !== "," && mappings[index] !== ";") {
      let shift = 0;
      let value = 0;
      let digit: number | undefined;
      do {
        digit = VLQ_VALUES.$get(mappings[index++]);
        if (digit === undefined) {
          originalOrder.sort(compareOriginalOrder);
          return { byGeneratedLine, originalOrder };
        }
        value += (digit & 31) << shift;
        shift += 5;
      } while (digit & 32 && index < length);
      fields.push(value & 1 ? -(value >> 1) : value >> 1);
    }
    if (fields.length === 0) continue;
    genColumn += fields[0];
    if (fields.length < 4) continue;
    originalLine += fields[2];
    originalColumn += fields[3];

    let line = byGeneratedLine[genLine];
    if (!line) {
      line = { columns: [], lineNumbers: [], columnNumbers: [] };
      byGeneratedLine[genLine] = line;
    }
    line.columns.push(genColumn);
    line.lineNumbers.push(originalLine);
    line.columnNumbers.push(originalColumn);
    originalOrder.push({
      lineNumber: originalLine,
      columnNumber: originalColumn,
      genLine,
      genColumn,
    });
  }

  originalOrder.sort(compareOriginalOrder);
  return { byGeneratedLine, originalOrder };
}

function compareOriginalOrder(a: AnyObject, b: AnyObject): number {
  return (
    a.lineNumber - b.lineNumber || a.columnNumber - b.columnNumber || a.genLine - b.genLine || a.genColumn - b.genColumn
  );
}

function generatedToOriginal(
  map: ScriptSourceMap,
  lineNumber: number,
  columnNumber: number,
): OriginalPosition | undefined {
  const { byGeneratedLine } = map;
  const line = byGeneratedLine[lineNumber];
  if (line) {
    const { columns } = line;
    let low = 0;
    let high = columns.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (columns[middle] <= columnNumber) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (found < 0) found = 0;
    return { lineNumber: line.lineNumbers[found], columnNumber: line.columnNumbers[found] };
  }
  for (let next = lineNumber + 1; next < byGeneratedLine.length; next++) {
    const candidate = byGeneratedLine[next];
    if (candidate) return { lineNumber: candidate.lineNumbers[0], columnNumber: candidate.columnNumbers[0] };
  }
  return undefined;
}

function originalToGenerated(
  map: ScriptSourceMap,
  lineNumber: number,
  columnNumber: number,
): OriginalPosition | undefined {
  const entries = map.originalOrder;
  let low = 0;
  let high = entries.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = entries[middle];
    if (entry.lineNumber > lineNumber || (entry.lineNumber === lineNumber && entry.columnNumber >= columnNumber)) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (found < 0) return undefined;
  return { lineNumber: entries[found].genLine, columnNumber: entries[found].genColumn };
}

const SOURCE_MAPPING_URL_COMMENT = "//# sourceMappingURL=";

function ownSourceMappingURL(source: string): string {
  const at = source.lastIndexOf(SOURCE_MAPPING_URL_COMMENT);
  if (at < 0) return "";
  const lineStart = source.lastIndexOf("\n", at) + 1;
  if (source.slice(lineStart, at).trim() !== "") return "";
  const end = source.indexOf("\n", at);
  return source.slice(at + SOURCE_MAPPING_URL_COMMENT.length, end < 0 ? source.length : end).trim();
}

const SCOPE_TYPE_MAP: Record<string, string> = {
  __proto__: null,
  global: "global",
  with: "with",
  closure: "closure",
  catch: "catch",
  functionName: "local",
  globalLexicalEnvironment: "script",
  nestedLexical: "block",
} as any;

const ASYNC_BOUNDARY_DESCRIPTIONS: Record<string, string> = {
  __proto__: null,
  setTimeout: "Timeout",
  setInterval: "Timeout",
  setImmediate: "Immediate",
  then: "Promise.then",
  catch: "Promise.catch",
  finally: "Promise.finally",
} as any;

// No "log" entry: JSC reports console.warn/error/info/debug as { type: "log", level: ... }, so a
// type match on "log" would mask the level. #translateConsoleMessage falls through to level map.
const CONSOLE_TYPE_MAP: Record<string, string> = {
  __proto__: null,
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
} as any;

const CONSOLE_LEVEL_MAP: Record<string, string> = {
  __proto__: null,
  log: "log",
  info: "info",
  warning: "warning",
  error: "error",
  debug: "debug",
} as any;

interface DisconnectNotifyState {
  handshakeStarted: boolean;
  retaining: number;
  adapters: Set<InspectorCDPAdapter> | undefined;
}

class InspectorCDPAdapter {
  #writeToBackend: (message: string) => void;
  #writeToClient: (message: string) => void;
  #nextExceptionId = 1;
  #pending = new Map<
    number,
    { clientId: number | string | null; method: string; onResult?: (result: AnyObject, error?: AnyObject) => void }
  >();
  #scripts = new Map<string, ScriptRecord>();
  #scriptIdsByUrl: Map<string, string> = new SafeMap();
  // By-URL breakpoints set before their script parsed, keyed by the id given to the client. Re-set
  // through the map at scriptParsed (as V8 does); events and removeBreakpoint map through jscId.
  // https://source.chromium.org/chromium/chromium/src/+/main:v8/src/inspector/v8-debugger-agent-impl.cc
  #preParseBreakpoints: Map<
    string,
    {
      jscId: string;
      url: string | undefined;
      urlRegex: string | undefined;
      lineNumber: number;
      columnNumber: number | undefined;
      condition: string | undefined;
      resolved: boolean;
      resetPending?: boolean;
      clientRemoved?: boolean;
    }
  > = new SafeMap();
  #breakpointIdAliases = new Map<string, string>();
  // Set when the stale-breakpoint auto-resume below sends Debugger.resume: the
  // client never saw the pause, so it must not see the matching resumed either.
  // Backend events arrive FIFO, so the very next resumed is the one to drop.
  #suppressNextResumed = false;
  #profilerTracking = false;
  #profilerStartTime = 0;
  #profilerStopClientIds: (number | string)[] = [];
  #nodeRuntimeEnabled = false;
  // JSC has one agent set and broadcasts its events to every frontend, so per-session
  // domain enables live here: events are only surfaced to a client that enabled the domain,
  // as V8's per-session agents do. Script/breakpoint bookkeeping still runs regardless.
  #debuggerEnabled = false;
  #runtimeEnabled = false;
  #notifyWhenWaitingForDisconnect = false;
  #retainingContext = false;
  #sentContextDestroyed = false;
  // Shared across this context's sessions. Node ORs the flag across channels: one opt-in defers
  // executionContextDestroyed for all. https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
  #disconnectNotify: DisconnectNotifyState;
  #isWaitingForDebugger: () => boolean;
  #allocateBackendId: () => number;

  constructor(
    writeToBackend: (message: string) => void,
    writeToClient: (message: string) => void,
    allocateBackendId: () => number,
    isWaitingForDebugger: () => boolean = () => false,
    disconnectNotify: DisconnectNotifyState = {
      handshakeStarted: false,
      retaining: 0,
      adapters: undefined,
    },
  ) {
    this.#writeToBackend = writeToBackend;
    this.#writeToClient = writeToClient;
    this.#isWaitingForDebugger = isWaitingForDebugger;
    this.#disconnectNotify = disconnectNotify;
    (disconnectNotify.adapters ??= new SafeSet()).add(this);
    this.#allocateBackendId = allocateBackendId;
  }

  #startHandshakeOnce(): void {
    const state = this.#disconnectNotify;
    if (state.handshakeStarted) return;
    state.handshakeStarted = true;
    state.retaining = 0;
    const peers = state.adapters;
    if (!peers) return;
    for (const peer of peers) {
      if (!peer.#notifyWhenWaitingForDisconnect) continue;
      peer.#retainingContext = true;
      state.retaining++;
    }
  }

  // node:inspector forwards an in-process Session's Debugger.enable/disable to the
  // remote-controlled backend when a server is up; the events still arrive through this
  // adapter, so that path records the enable here instead of via #dispatchClientCommand.
  noteDebuggerEnabled(enabled: boolean): void {
    this.#debuggerEnabled = enabled;
  }

  handleClientDisconnect(): void {
    this.#debuggerEnabled = false;
    this.#runtimeEnabled = false;
    this.#scripts.$clear();
    this.#scriptIdsByUrl.clear();
    this.#preParseBreakpoints.clear();
    this.#breakpointIdAliases.$clear();
    this.#pending.$clear();
    this.#profilerStopClientIds.length = 0;
    const state = this.#disconnectNotify;
    state.adapters?.delete(this);
    this.#notifyWhenWaitingForDisconnect = false;
    if (!this.#retainingContext) return;
    this.#retainingContext = false;
    state.retaining--;
    if (state.retaining > 0 || !state.handshakeStarted) return;
    const peers = state.adapters;
    if (!peers) return;
    for (const peer of peers) peer.#emitContextDestroyed();
  }

  #emitContextDestroyed(): void {
    if (this.#sentContextDestroyed) return;
    this.#sentContextDestroyed = true;
    this.#emitToClient("Runtime.executionContextDestroyed", {
      executionContextId: EXECUTION_CONTEXT_ID,
    });
  }

  #sourceMapFor(scriptId: string | undefined): ScriptSourceMap | undefined {
    if (!scriptId) return undefined;
    const script = this.#scripts.$get(scriptId);
    if (!script) return undefined;
    if (script.map === undefined && script.mappings !== undefined) {
      script.map = decodeMappings(script.mappings);
      script.mappings = undefined;
    }
    return script.map;
  }

  #mapToOriginalLocation(location: AnyObject): AnyObject {
    return this.#toOriginalLocation(location) as AnyObject;
  }

  #onBreakpointReset(bp: AnyObject, clientBreakpointId: string, result: AnyObject, error: AnyObject) {
    bp.resetPending = false;
    if (error || typeof result.breakpointId !== "string") return;
    const { breakpointId } = result;
    if (bp.clientRemoved) {
      this.#sendToBackend("Debugger.removeBreakpoint", { breakpointId });
      return;
    }
    this.#breakpointIdAliases.$delete(bp.jscId);
    bp.jscId = breakpointId;
    if (breakpointId !== clientBreakpointId) this.#breakpointIdAliases.$set(breakpointId, clientBreakpointId);
    const location = result.locations?.[0];
    if (location) {
      this.#emitToClient("Debugger.breakpointResolved", {
        breakpointId: clientBreakpointId,
        location: this.#toOriginalLocation(location),
      });
    }
  }

  #onEvaluateForAwaitPromise(id: number, method: string, params: AnyObject, result: AnyObject, error: AnyObject) {
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
    // Primitive/thrown: nothing to await. A thrown non-primitive already has an objectId (step one
    // forced returnByValue:false), which clients inspect via exceptionDetails — do not re-serialize.
    this.#replyToClient(id, this.#translateResult(method, result));
  }

  #onProfilerStartReply(id: number, _result: AnyObject, error: AnyObject) {
    if (error) {
      this.#profilerTracking = false;
      this.#replyErrorToClient(id, error.code ?? -32000, error.message ?? "Unknown error");
      return;
    }
    this.#replyToClient(id, {});
  }

  #onProfilerStopReply(id: number, _result: AnyObject, error: AnyObject) {
    if (error) {
      const at = this.#profilerStopClientIds.indexOf(id);
      if (at >= 0) this.#profilerStopClientIds.splice(at, 1);
      this.#replyErrorToClient(id, error.code ?? -32000, error.message ?? "Unknown error");
    }
  }

  #forwardCallFunctionOn(id: number, method: string, params: AnyObject, targetObjectId: unknown) {
    this.#sendToBackend(
      "Runtime.callFunctionOn",
      {
        objectId: targetObjectId,
        functionDeclaration: params.functionDeclaration,
        arguments: params.arguments,
        doNotPauseOnExceptionsAndMuteConsole: params.silent,
        returnByValue: params.returnByValue,
        generatePreview: params.generatePreview,
        emulateUserGesture: params.userGesture,
        awaitPromise: params.awaitPromise,
      },
      id,
      method,
    );
  }

  #onGlobalObjectForCallFunctionOn(id: number, method: string, params: AnyObject, result: AnyObject, error: AnyObject) {
    const globalObjectId = result.result?.objectId;
    if (error || !globalObjectId) {
      this.#replyErrorToClient(id, error?.code ?? -32000, error?.message ?? "Failed to resolve global object");
      return;
    }
    this.#forwardCallFunctionOn(id, method, params, globalObjectId);
  }

  #onPreParseBreakpointSet(
    id: number,
    method: string,
    params: AnyObject,
    url: string | undefined,
    urlRegex: string | undefined,
    condition: string | undefined,
    result: AnyObject,
    error: AnyObject,
  ) {
    if (error) {
      this.#replyErrorToClient(id, error.code ?? -32000, error.message ?? "Unknown error");
      return;
    }
    const breakpointId = result.breakpointId;
    if (typeof breakpointId === "string") {
      const bp = {
        jscId: breakpointId,
        url,
        urlRegex,
        lineNumber: params.lineNumber ?? 0,
        columnNumber: params.columnNumber,
        condition,
        resolved: false,
      };
      this.#preParseBreakpoints.set(breakpointId, bp);
      const scriptId =
        url !== undefined
          ? this.#scriptIdsByUrl.get(url)
          : urlRegex !== undefined
            ? this.#scriptIdMatching(urlRegex)
            : undefined;
      if (scriptId !== undefined) {
        const script = this.#scripts.$get(scriptId);
        if (script && (script.mappings !== undefined || script.map !== undefined)) {
          this.#resetPreParseBreakpoint(breakpointId, bp, scriptId);
        }
      }
    }
    this.#replyToClient(id, this.#translateResult(method, result));
  }

  #toOriginalLocation(location: AnyObject | undefined): AnyObject | undefined {
    if (!location) return location;
    const map = this.#sourceMapFor(location.scriptId);
    if (!map) return location;
    const position = generatedToOriginal(map, location.lineNumber ?? 0, location.columnNumber ?? 0);
    if (!position) return location;
    const translated: AnyObject = { scriptId: location.scriptId, lineNumber: position.lineNumber };
    translated.columnNumber = position.columnNumber;
    return translated;
  }

  #toGeneratedLocation(location: AnyObject | undefined): AnyObject | undefined {
    if (!location) return location;
    const map = this.#sourceMapFor(location.scriptId);
    if (!map) return location;
    const position = originalToGenerated(map, location.lineNumber ?? 0, location.columnNumber ?? 0);
    if (!position) return location;
    const translated: AnyObject = { scriptId: location.scriptId, lineNumber: position.lineNumber };
    translated.columnNumber = position.columnNumber;
    return translated;
  }

  #isStaleResetBreakpoint(breakpointId: string): boolean {
    for (const bp of this.#preParseBreakpoints.values()) {
      if (bp.resetPending && bp.jscId === breakpointId) return true;
    }
    return false;
  }

  #toClientBreakpointId(breakpointId: string): string {
    return this.#breakpointIdAliases.$get(breakpointId) ?? breakpointId;
  }

  #retranslatePreParseBreakpoints(url: string, cdpUrl: string, scriptId: string): void {
    if (this.#preParseBreakpoints.size === 0) return;
    const script = this.#scripts.$get(scriptId);
    if (!script || (script.mappings === undefined && script.map === undefined)) return;
    for (const [clientBreakpointId, bp] of this.#preParseBreakpoints) {
      if (bp.resolved) continue;
      const { url: bpUrl, urlRegex: bpUrlRegex } = bp;
      let matches = false;
      if (bpUrl !== undefined) {
        matches = bpUrl === url || bpUrl === cdpUrl;
      } else if (bpUrlRegex !== undefined) {
        try {
          const pattern = new RegExp(bpUrlRegex);
          matches = pattern.test(url) || pattern.test(cdpUrl);
        } catch {
          matches = false;
        }
      }
      if (!matches) continue;
      this.#resetPreParseBreakpoint(clientBreakpointId, bp, scriptId);
    }
  }

  #resetPreParseBreakpoint(clientBreakpointId: string, bp: AnyObject, scriptId: string): void {
    bp.resolved = true;
    const generated = this.#toGeneratedLocation({
      scriptId,
      lineNumber: bp.lineNumber,
      columnNumber: bp.columnNumber ?? 0,
    }) as AnyObject;
    if (generated.lineNumber === bp.lineNumber && (generated.columnNumber ?? 0) === (bp.columnNumber ?? 0)) {
      return;
    }
    bp.resetPending = true;
    this.#sendToBackend("Debugger.removeBreakpoint", { breakpointId: bp.jscId });
    const options: AnyObject = {};
    const { condition } = bp;
    if (condition) options.condition = condition;
    this.#sendToBackend(
      "Debugger.setBreakpointByUrl",
      {
        lineNumber: generated.lineNumber,
        columnNumber: generated.columnNumber,
        options,
        urlRegex: bp.urlRegex ?? breakpointUrlRegex(bp.url!),
      },
      null,
      "Debugger.setBreakpointByUrl",
      this.#onBreakpointReset.bind(this, bp, clientBreakpointId),
    );
  }

  #scriptIdMatching(urlRegex: string): string | undefined {
    let pattern: RegExp;
    try {
      pattern = new RegExp(urlRegex);
    } catch {
      return undefined;
    }
    for (const [candidate, scriptId] of this.#scriptIdsByUrl) {
      if (pattern.test(candidate)) return scriptId;
    }
    return undefined;
  }

  #toOriginalLocations(locations: AnyObject[] | undefined): AnyObject[] {
    if (!locations) return [];
    return locations.map(this.#mapToOriginalLocation, this);
  }

  handleClientMessage(message: string): void {
    let parsed: AnyObject;
    try {
      parsed = JSON.parse(message);
    } catch {
      // JSON-RPC -32700 Parse error: https://www.jsonrpc.org/specification#error_object
      this.#replyErrorToClient(0, -32700, "Parse error");
      return;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.method !== "string") {
      // JSON-RPC -32600 Invalid Request: https://www.jsonrpc.org/specification#error_object
      this.#replyErrorToClient(parsed?.id ?? 0, -32600, "Invalid Request");
      return;
    }
    const { id, method, params } = parsed;
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
    const id = this.#allocateBackendId();
    this.#pending.$set(id, { clientId, method: clientMethod, onResult });
    this.#writeToBackend(JSON.stringify(params === undefined ? { id, method } : { id, method, params }));
  }

  #dispatchClientCommand(id: number | string, method: string, params: AnyObject): void {
    switch (method) {
      // ── Runtime ──────────────────────────────────────────────────────────
      case "Runtime.enable":
        // Set before the sends: the in-process dispatch is synchronous, so the backend's
        // replay of buffered console messages arrives inside #sendToBackend.
        this.#runtimeEnabled = true;
        // JSGlobalObject inspection has a single execution context; CDP clients
        // need at least one announced for the console and evaluation to work.
        this.#emitToClient("Runtime.executionContextCreated", {
          context: {
            id: EXECUTION_CONTEXT_ID,
            origin: "",
            name: "Bun",
            uniqueId: String(EXECUTION_CONTEXT_ID),
            // vscode-js-debug / puppeteer select the default context via auxData.isDefault:
            // https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-ExecutionContextDescription
            auxData: { isDefault: true },
          },
        });
        this.#sendToBackend("Runtime.enable");
        // Console.messageAdded is re-emitted as Runtime.consoleAPICalled. Answer from this command
        // so console events flow before the client sees Runtime.enable resolve.
        this.#sendToBackend("Console.enable", undefined, id, method);
        return;

      case "Runtime.disable":
        this.#runtimeEnabled = false;
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
        // JSC has no awaitPromise on Runtime.evaluate; chain Runtime.awaitPromise on the result.
        // Step one forces returnByValue:false so the Promise yields an objectId, not a serialization.
        if (params.awaitPromise === true) {
          const firstStep = { ...jscParams, returnByValue: false };
          this.#sendToBackend(
            "Runtime.evaluate",
            firstStep,
            null,
            method,
            this.#onEvaluateForAwaitPromise.bind(this, id, method, params),
          );
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
        if (objectId) {
          this.#forwardCallFunctionOn(id, method, params, objectId);
          return;
        }
        if (executionContextId === undefined) {
          this.#replyErrorToClient(id, -32602, "Either objectId or executionContextId must be specified");
          return;
        }
        // CDP allows executionContextId-only (this === globalThis); JSC requires an objectId, so
        // fetch the global's first. Pass objectGroup so releaseObjectGroup reclaims this handle.
        this.#sendToBackend(
          "Runtime.evaluate",
          { expression: "globalThis", objectGroup: params.objectGroup },
          null,
          method,
          this.#onGlobalObjectForCallFunctionOn.bind(this, id, method, params),
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
        // Set before the send: the synchronous in-process dispatch delivers the
        // scriptParsed replay for already-parsed scripts inside #sendToBackend.
        this.#debuggerEnabled = true;
        this.#sendToBackend("Debugger.enable");
        // V8's Debugger.enable implicitly arms breakpoints and `debugger;`; JSC requires explicit
        // opt-in. Answer from the last command so pausing is armed before the client runs code.
        // https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-enable
        this.#sendToBackend("Debugger.setBreakpointsActive", { active: true });
        this.#sendToBackend("Debugger.setPauseOnDebuggerStatements", { enabled: true }, id, method);
        return;

      case "Debugger.disable":
        this.#debuggerEnabled = false;
        this.#sendToBackend(method, params, id, method);
        return;

      case "Debugger.pause":
      case "Debugger.resume":
      case "Debugger.stepInto":
      case "Debugger.stepOut":
      case "Debugger.stepOver":
      case "Debugger.setBreakpointsActive":
        this.#sendToBackend(method, params, id, method);
        return;

      case "Debugger.removeBreakpoint": {
        const tracked = this.#preParseBreakpoints.get(params.breakpointId);
        if (tracked) {
          this.#preParseBreakpoints.delete(params.breakpointId);
          this.#breakpointIdAliases.$delete(tracked.jscId);
          if (tracked.resetPending) {
            tracked.clientRemoved = true;
            this.#replyToClient(id, {});
            return;
          }
          this.#sendToBackend(method, { breakpointId: tracked.jscId }, id, method);
          return;
        }
        this.#sendToBackend(method, params, id, method);
        return;
      }

      case "Debugger.continueToLocation":
        this.#sendToBackend(
          "Debugger.continueToLocation",
          { location: this.#toGeneratedLocation(params.location) },
          id,
          method,
        );
        return;

      case "Debugger.getScriptSource": {
        const script = this.#scripts.$get(params.scriptId);
        if (script?.source !== undefined) {
          this.#replyToClient(id, { scriptSource: script.source });
          return;
        }
        this.#sendToBackend(method, params, id, method);
        return;
      }

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
        const known = url ? this.#scriptIdsByUrl.get(url) : urlRegex ? this.#scriptIdMatching(urlRegex) : undefined;
        const generated = this.#toGeneratedLocation({
          scriptId: known,
          lineNumber: params.lineNumber ?? 0,
          columnNumber: params.columnNumber ?? 0,
        }) as AnyObject;
        const jscParams: AnyObject = {
          lineNumber: generated.lineNumber,
          columnNumber: generated.columnNumber,
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
        if (known === undefined) {
          this.#sendToBackend(
            "Debugger.setBreakpointByUrl",
            jscParams,
            null,
            method,
            this.#onPreParseBreakpointSet.bind(this, id, method, params, url, urlRegex, condition),
          );
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
            location: this.#toGeneratedLocation(params.location),
            options: condition ? { condition } : undefined,
          },
          id,
          method,
        );
        return;
      }

      case "Debugger.getPossibleBreakpoints": {
        const start = this.#toGeneratedLocation(params.start);
        let end = params.end ? this.#toGeneratedLocation(params.end) : undefined;
        if (!end) {
          const script = this.#scripts.$get(params.start?.scriptId);
          end = {
            scriptId: params.start?.scriptId,
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

      case "Profiler.start":
        this.#profilerTracking = true;
        this.#sendToBackend(
          "ScriptProfiler.startTracking",
          { includeSamples: true },
          null,
          method,
          this.#onProfilerStartReply.bind(this, id),
        );
        return;

      case "Profiler.stop":
        if (!this.#profilerTracking) {
          this.#replyErrorToClient(id, -32000, "No recording profiles found");
          return;
        }
        this.#profilerTracking = false;
        this.#profilerStopClientIds.push(id);
        this.#sendToBackend(
          "ScriptProfiler.stopTracking",
          undefined,
          null,
          method,
          this.#onProfilerStopReply.bind(this, id),
        );
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
        this.#replyToClient(id, {});
        return;

      case "NodeRuntime.notifyWhenWaitingForDisconnect":
        this.#notifyWhenWaitingForDisconnect = !!params.enabled;
        this.#replyToClient(id, {});
        return;

      case "NodeRuntime.enable":
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
        return { locations: this.#toOriginalLocations(result.locations) };

      case "Debugger.setBreakpointByUrl":
        return { breakpointId: result.breakpointId, locations: this.#toOriginalLocations(result.locations) };

      case "Debugger.setBreakpoint":
        return {
          breakpointId: result.breakpointId,
          actualLocation: this.#toOriginalLocation(result.actualLocation ?? result.location),
        };

      default:
        return result;
    }
  }

  #translateBackendEvent(method: string, params: AnyObject): void {
    switch (method) {
      case "Debugger.scriptParsed": {
        const url = params.sourceURL || params.url || "";
        const cdpUrl = toCdpUrl(url);
        const decoded = decodeSourceMapURL(params.sourceMapURL);
        const contents = decoded?.sourcesContent;
        const source = typeof contents?.[0] === "string" ? contents[0] : undefined;
        let endLine = params.endLine ?? 0;
        let endColumn = params.endColumn ?? 0;
        let sourceMapURL = params.sourceMapURL;
        if (source !== undefined) {
          const lastNewline = source.lastIndexOf("\n");
          endLine = 0;
          for (let at = source.indexOf("\n"); at >= 0; at = source.indexOf("\n", at + 1)) endLine++;
          endColumn = source.length - lastNewline - 1;
          sourceMapURL = ownSourceMappingURL(source);
        }
        this.#scripts.$set(params.scriptId, {
          cdpUrl,
          endLine: params.endLine ?? 0,
          endColumn: params.endColumn ?? 0,
          source,
          mappings: source === undefined ? undefined : decoded!.mappings,
          map: undefined,
        });
        if (url) this.#scriptIdsByUrl.set(url, params.scriptId);
        if (cdpUrl) this.#scriptIdsByUrl.set(cdpUrl, params.scriptId);
        if (this.#debuggerEnabled) {
          const { scriptType } = params;
          this.#emitToClient("Debugger.scriptParsed", {
            scriptId: params.scriptId,
            url: cdpUrl,
            startLine: params.startLine ?? 0,
            startColumn: params.startColumn ?? 0,
            endLine,
            endColumn,
            executionContextId: EXECUTION_CONTEXT_ID,
            hash: "",
            isModule: scriptType === "module",
            sourceMapURL,
            embedderName: cdpUrl,
            scriptLanguage: scriptType === "webassembly" ? "WebAssembly" : "JavaScript",
          });
        }
        this.#retranslatePreParseBreakpoints(url, cdpUrl, params.scriptId);
        return;
      }

      case "Debugger.paused": {
        if (
          params.reason === "Breakpoint" &&
          typeof params.data?.breakpointId === "string" &&
          this.#isStaleResetBreakpoint(params.data.breakpointId)
        ) {
          this.#suppressNextResumed = true;
          this.#sendToBackend("Debugger.resume");
          return;
        }
        if (!this.#debuggerEnabled) return;
        const callFrames = (params.callFrames ?? []).map((frame: AnyObject) => ({
          callFrameId: frame.callFrameId,
          functionName: frame.functionName ?? "",
          location: this.#toOriginalLocation(frame.location),
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
            if (data?.breakpointId) cdpParams.hitBreakpoints = [this.#toClientBreakpointId(data.breakpointId)];
            break;
        }
        if (asyncStackTrace) cdpParams.asyncStackTrace = this.#translateStackTrace(asyncStackTrace);
        this.#emitToClient("Debugger.paused", cdpParams);
        return;
      }

      case "Debugger.resumed":
        if (this.#suppressNextResumed) {
          this.#suppressNextResumed = false;
          return;
        }
        if (this.#debuggerEnabled) this.#emitToClient("Debugger.resumed", {});
        return;

      case "Debugger.breakpointResolved":
        if (!this.#debuggerEnabled || this.#isStaleResetBreakpoint(params.breakpointId)) return;
        this.#emitToClient("Debugger.breakpointResolved", {
          breakpointId: this.#toClientBreakpointId(params.breakpointId),
          location: this.#toOriginalLocation(params.location),
        });
        return;

      case "Debugger.globalObjectCleared":
        if (this.#runtimeEnabled) this.#emitToClient("Runtime.executionContextsCleared", {});
        return;

      case "Console.messageAdded":
        // In-process Sessions get consoleAPICalled from node:inspector's own console hook and
        // never enable Runtime through this adapter, so this also keeps a remote client's
        // Console.enable from duplicating their events.
        if (this.#runtimeEnabled) this.#translateConsoleMessage(params.message || {});
        return;

      case "ScriptProfiler.trackingStart":
        this.#profilerStartTime = params.timestamp ?? 0;
        return;

      case "ScriptProfiler.trackingComplete": {
        const clientId = this.#profilerStopClientIds.shift();
        if (clientId === undefined) {
          this.#profilerTracking = false;
          return;
        }
        this.#replyToClient(clientId, { profile: this.#translateSamplingProfile(params) });
        this.#profilerStartTime = 0;
        return;
      }

      case "Bun.waitingForDisconnect":
        // Inspected thread reached exit. Mirrors Node's notifyWaitingForDisconnect: opted-in sessions
        // get waitingForDisconnect; others see contextDestroyed only once the last retaining session
        // leaves. https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
        this.#startHandshakeOnce();
        if (this.#retainingContext) {
          this.#emitToClient("NodeRuntime.waitingForDisconnect", {});
        } else if (this.#disconnectNotify.retaining === 0) {
          this.#emitContextDestroyed();
        }
        return;

      case "Bun.waitingForDebugger":
        if (this.#nodeRuntimeEnabled) {
          this.#emitToClient("NodeRuntime.waitingForDebugger", {});
        }
        return;

      default:
        // JSC- and Bun-specific events have no CDP equivalent.
        return;
    }
  }

  #translateSamplingProfile(params: AnyObject): AnyObject {
    const stackTraces: AnyObject[] = params.samples?.stackTraces ?? [];
    const root: AnyObject = {
      id: 1,
      callFrame: { functionName: "(root)", scriptId: "0", url: "", lineNumber: -1, columnNumber: -1 },
      hitCount: 0,
      children: [],
    };
    const nodes: AnyObject[] = [root];
    const interned = new Map<string, AnyObject>();
    const samples: number[] = [];
    const timeDeltas: number[] = [];
    const startTime = this.#profilerStartTime || (stackTraces.length ? (stackTraces[0].timestamp ?? 0) : 0);
    let previous = startTime;
    for (const trace of stackTraces) {
      let parent = root;
      const frames: AnyObject[] = trace.stackFrames ?? [];
      for (let i = frames.length - 1; i >= 0; i--) {
        const frame = frames[i];
        const key = `${parent.id}\u0000${frame.sourceID}\u0000${frame.name}\u0000${frame.line}\u0000${frame.column}`;
        let node = interned.$get(key);
        if (!node) {
          const location = this.#toOriginalLocation({
            scriptId: frame.sourceID,
            lineNumber: Math.max((frame.line ?? 1) - 1, 0),
            columnNumber: Math.max((frame.column ?? 1) - 1, 0),
          }) as AnyObject;
          node = {
            id: nodes.length + 1,
            callFrame: {
              functionName: frame.name ?? "",
              scriptId: String(frame.sourceID ?? "0"),
              url: toCdpUrl(frame.url ?? ""),
              lineNumber: location.lineNumber,
              columnNumber: location.columnNumber,
            },
            hitCount: 0,
            children: [],
          };
          nodes.push(node);
          parent.children.push(node.id);
          interned.$set(key, node);
        }
        parent = node;
      }
      parent.hitCount++;
      samples.push(parent.id);
      const timestamp = Math.max(previous, typeof trace.timestamp === "number" ? trace.timestamp : previous);
      timeDeltas.push(Math.round((timestamp - previous) * 1e6));
      previous = timestamp;
    }
    const endTime = Math.max(params.timestamp ?? 0, previous);
    return {
      nodes,
      startTime: Math.round(startTime * 1e6),
      endTime: Math.round(endTime * 1e6),
      samples,
      timeDeltas,
    };
  }

  #translateStackTrace(stackTrace: AnyObject | undefined): AnyObject | undefined {
    if (!stackTrace) return undefined;
    const frames: AnyObject[] = stackTrace.callFrames ?? [];
    const boundary = stackTrace.topCallFrameIsBoundary && frames.length ? frames[0] : undefined;
    const description = boundary ? ASYNC_BOUNDARY_DESCRIPTIONS[boundary.functionName ?? ""] : undefined;
    const translated: AnyObject = {
      callFrames: (boundary ? frames.slice(1) : frames).map((frame: AnyObject) => {
        const scriptId = frame.scriptId ?? this.#scriptIdsByUrl.get(frame.url ?? "") ?? "";
        const location = this.#toOriginalLocation({
          scriptId,
          lineNumber: Math.max((frame.lineNumber ?? 1) - 1, 0),
          columnNumber: Math.max((frame.columnNumber ?? 1) - 1, 0),
        }) as AnyObject;
        return {
          functionName: frame.functionName ?? "",
          scriptId,
          url: toCdpUrl(frame.url ?? ""),
          lineNumber: location.lineNumber,
          columnNumber: location.columnNumber,
        };
      }),
    };
    // CDP's description names the scheduler; a boundary outside the pretty-name
    // table still had its identity in the dropped frame, so fall back to it.
    if (boundary) translated.description = description ?? boundary.functionName ?? "";
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
      const reported = this.#toOriginalLocation({
        scriptId: this.#scriptIdsByUrl.get(message.url ?? ""),
        lineNumber: Math.max((message.line ?? 1) - 1, 0),
        columnNumber: Math.max((message.column ?? 1) - 1, 0),
      }) as AnyObject;
      this.#emitToClient("Runtime.exceptionThrown", {
        timestamp: message.timestamp ?? Date.now(),
        exceptionDetails: {
          exceptionId: this.#nextExceptionId++,
          text: message.text ?? "Uncaught",
          lineNumber: reported.lineNumber,
          columnNumber: reported.columnNumber,
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

export type { InspectorCDPAdapter };

export default {
  InspectorCDPAdapter,
};
