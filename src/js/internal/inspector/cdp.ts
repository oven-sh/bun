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
const { Buffer } = require("node:buffer");
const { basename, isAbsolute } = require("node:path");

const EXECUTION_CONTEXT_ID = 1;
// Bun names code with no file of its own after the directory it ran in:
// `<cwd>/[eval]` for -e/--eval/-p, `<cwd>/[stdin]` for `bun -`. Node reports
// the bare names; a real file so named is reported that way too, as in Node.
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
    // The reverse of toCdpUrl. Anchored on the trailing path segment rather
    // than on a cwd captured here: the debugger thread's cwd can differ from
    // the one the script URL was built with.
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
// Bun transpiles every script it runs, so the code JSC parsed is not the code
// the user wrote: `--inspect-brk` prepends a `debugger;`, comments and blank
// lines are dropped, and constants are folded. V8 has no transpile step, so a
// CDP client is entitled to positions in the original file. Bun's transpiler
// appends an inline sourceMappingURL carrying both the mappings and the
// original text, so the adapter can present the original script and translate
// every position it reports or accepts.
//
// Only this adapter does so. Clients of Bun's own JSC endpoint keep seeing
// generated positions plus the sourceMappingURL, and apply the map themselves.
// Translating here and still advertising that map would make such a client
// apply it twice, so the map is not forwarded: to a CDP client the script *is*
// the original.

interface OriginalPosition {
  lineNumber: number;
  columnNumber: number;
}

interface GeneratedLine {
  // Parallel arrays, ascending by `columns`, of every mapping on one line of
  // the generated script.
  columns: number[];
  lineNumbers: number[];
  columnNumbers: number[];
}

interface ScriptSourceMap {
  byGeneratedLine: (GeneratedLine | undefined)[];
  // Every mapping, ascending by original position, for original -> generated.
  originalOrder: { lineNumber: number; columnNumber: number; genLine: number; genColumn: number }[];
}

interface ScriptRecord {
  cdpUrl: string;
  endLine: number;
  endColumn: number;
  // Both undefined for a script with no map of Bun's own: an internal module,
  // a `vm` compilation, or code the client itself evaluated.
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
  // Only the inline map Bun itself produced. A `//# sourceMappingURL=foo.map`
  // pointing at a file is the user's own map and is forwarded untouched.
  if (!sourceMapURL || !sourceMapURL.startsWith("data:application/json")) return undefined;
  const comma = sourceMapURL.indexOf(",");
  if (comma < 0) return undefined;
  try {
    const payload = sourceMapURL.slice(comma + 1);
    const text = sourceMapURL.slice(0, comma).endsWith(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    const map = JSON.parse(text);
    // A runtime-transpiled script has exactly one source. A pre-bundled file
    // whose map names several cannot be shown as one original script, so it is
    // left alone.
    if (!map || typeof map.mappings !== "string") return undefined;
    if (!Array.isArray(map.sources) || map.sources.length !== 1) return undefined;
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
    // Decode up to four VLQ fields: generated column, source index, original
    // line, original column. A one-field segment marks generated code with no
    // original position and is skipped.
    const fields: number[] = [];
    while (index < length && mappings[index] !== "," && mappings[index] !== ";") {
      let shift = 0;
      let value = 0;
      let digit: number | undefined;
      do {
        digit = VLQ_VALUES.$get(mappings[index++]);
        if (digit === undefined) return { byGeneratedLine, originalOrder };
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

// The last mapping at or before `columnNumber` on `lineNumber`. Falls forward
// to the next mapped position when there is none: the generated line may be
// code Bun injected, and `--inspect-brk`'s prepended `debugger;` is exactly
// that. Node breaks on the first statement of the user's script, which is what
// falling forward from the injected line resolves to.
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

// The first generated position at or after an original one, so a breakpoint
// set on a line the transpiler moved still lands on that line's code.
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

// The original file's own sourceMappingURL, if it has one. Bun's is stripped:
// it describes the generated text, which a CDP client never sees.
function ownSourceMappingURL(source: string): string {
  const at = source.lastIndexOf(SOURCE_MAPPING_URL_COMMENT);
  if (at < 0) return "";
  const end = source.indexOf("\n", at);
  return source.slice(at + SOURCE_MAPPING_URL_COMMENT.length, end < 0 ? source.length : end).trim();
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

// JSC reports the async boundary itself as the top frame of an async stack
// (`setTimeout`, `then`, ...). V8 has no such frame; it names the boundary in
// `description`. Boundaries without a V8 counterpart are left undescribed.
const ASYNC_BOUNDARY_DESCRIPTIONS: Record<string, string> = {
  setTimeout: "Timeout",
  setInterval: "Timeout",
  setImmediate: "Immediate",
  then: "Promise.then",
  catch: "Promise.catch",
  finally: "Promise.finally",
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

// Per-server, shared by every CDP session attached to one inspected context.
interface DisconnectNotifyState {
  handshakeStarted: boolean;
  // Node's Agent::retaining_context_: how many sessions were retaining the
  // context at handshake time. Snapshotted, so a session opting in afterwards
  // can neither suppress nor duplicate the deferred executionContextDestroyed.
  retaining: number;
  adapters: Set<InspectorCDPAdapter> | undefined;
}

class InspectorCDPAdapter {
  #writeToBackend: (message: string) => void;
  #writeToClient: (message: string) => void;
  #nextBackendId = 1;
  #nextExceptionId = 1;
  #pending = new Map<
    number,
    { clientId: number | string | null; method: string; onResult?: (result: AnyObject, error?: AnyObject) => void }
  >();
  #scripts = new Map<string, ScriptRecord>();
  // Every spelling of a script's URL, so a console message or a breakpoint
  // request that names one can be matched back to its sourcemap.
  #scriptIdsByUrl = new Map<string, string>();
  // By-URL breakpoints set before their script parsed, keyed by the
  // breakpointId the client was given. When the script arrives with a source
  // map they are re-set through it (V8 re-resolves by-URL breakpoints at
  // scriptParsed the same way); the client keeps the original id, so events
  // and removeBreakpoint are mapped through jscId.
  #preParseBreakpoints = new Map<
    string,
    {
      jscId: string;
      url: string | undefined;
      urlRegex: string | undefined;
      lineNumber: number;
      columnNumber: number | undefined;
      condition: string | undefined;
      resolved: boolean;
    }
  >();
  // Current backend breakpointId -> the id the client knows (only entries that
  // were re-set diverge).
  #breakpointIdAliases = new Map<string, string>();
  // NodeRuntime domain state, per connection, mirroring Node's RuntimeAgent.
  #nodeRuntimeEnabled = false;
  #notifyWhenWaitingForDisconnect = false;
  // This session's slice of retaining_context_, fixed when the handshake began.
  #retainingContext = false;
  #sentContextDestroyed = false;
  // Shared with this context's other sessions. Node's notifyWaitingForDisconnect
  // ORs the flag across every channel: one opt-in suppresses
  // executionContextDestroyed for all of them at handshake time, and the
  // sessions that did not opt in get it once the last retaining session leaves.
  #disconnectNotify: DisconnectNotifyState;
  #isWaitingForDebugger: () => boolean;

  // `allocateBackendId` lets several adapters share one backend whose
  // replies are broadcast to all of them (JSC's FrontendRouter): a shared
  // allocator keeps their command ids disjoint, so each claims only its own.
  #allocateBackendId: (() => number) | undefined;

  constructor(
    writeToBackend: (message: string) => void,
    writeToClient: (message: string) => void,
    isWaitingForDebugger: () => boolean = () => false,
    disconnectNotify: DisconnectNotifyState = {
      handshakeStarted: false,
      retaining: 0,
      adapters: undefined,
    },
    allocateBackendId?: () => number,
  ) {
    this.#writeToBackend = writeToBackend;
    this.#writeToClient = writeToClient;
    this.#isWaitingForDebugger = isWaitingForDebugger;
    this.#disconnectNotify = disconnectNotify;
    (disconnectNotify.adapters ??= new Set()).add(this);
    this.#allocateBackendId = allocateBackendId;
  }

  // Node takes retaining_context_ once, inside notifyWaitingForDisconnect, so
  // fix every session's share of it the first time any session is told.
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

  // The WebSocket for this session went away. Mirrors Node's
  // disconnectFrontend: if this was the last session retaining the context
  // during the exit handshake, the others finally see the context go.
  handleClientDisconnect(): void {
    const state = this.#disconnectNotify;
    state.adapters?.delete(this);
    this.#notifyWhenWaitingForDisconnect = false;
    // Only a session that was retaining the context at handshake time can
    // release it, and only once.
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

  // Decoding the mappings is deferred: a session may never ask about a
  // position in a given script, and every module Bun runs carries a map.
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

  #toClientBreakpointId(breakpointId: string): string {
    return this.#breakpointIdAliases.$get(breakpointId) ?? breakpointId;
  }

  // Re-sets by-URL breakpoints that predate their script through the script's
  // map, now that there is one. JSC keys a URL breakpoint on one generated
  // coordinate, so the first matching script with a map wins; later scripts
  // for the same URL keep that binding.
  #retranslatePreParseBreakpoints(url: string, cdpUrl: string, scriptId: string): void {
    if (this.#preParseBreakpoints.size === 0) return;
    const script = this.#scripts.$get(scriptId);
    // Without a map the original coordinates were already the right ones.
    if (!script || script.mappings === undefined) return;
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
      bp.resolved = true;
      const generated = this.#toGeneratedLocation({
        scriptId,
        lineNumber: bp.lineNumber,
        columnNumber: bp.columnNumber ?? 0,
      }) as AnyObject;
      if (generated.lineNumber === bp.lineNumber && (generated.columnNumber ?? 0) === (bp.columnNumber ?? 0)) {
        continue; // The map is an identity for this position.
      }
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
          urlRegex: bpUrlRegex ?? breakpointUrlRegex(bpUrl!),
        },
        null,
        "Debugger.setBreakpointByUrl",
        (result, error) => {
          if (error || typeof result.breakpointId !== "string") return;
          const { breakpointId } = result;
          this.#breakpointIdAliases.$delete(bp.jscId);
          bp.jscId = breakpointId;
          if (breakpointId !== clientBreakpointId) this.#breakpointIdAliases.$set(breakpointId, clientBreakpointId);
        },
      );
    }
  }

  // A client may address a script by pattern rather than by URL. Matching it
  // against the scripts already announced keeps a breakpoint request in the
  // same coordinates as the response it gets back.
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
    return locations.map(location => this.#toOriginalLocation(location) as AnyObject);
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
    const id = this.#allocateBackendId !== undefined ? this.#allocateBackendId() : this.#nextBackendId++;
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
        this.#sendToBackend(method, params, id, method);
        return;

      case "Debugger.removeBreakpoint": {
        // The client removes by the id it was originally given; a re-set
        // breakpoint lives in JSC under a newer id.
        const tracked = this.#preParseBreakpoints.$get(params.breakpointId);
        if (tracked) {
          this.#preParseBreakpoints.$delete(params.breakpointId);
          this.#breakpointIdAliases.$delete(tracked.jscId);
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
        // The client is shown the original file, so serve it from the map
        // rather than handing back what the transpiler produced.
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
        // The line the client names is a line of the original file. Resolve it
        // through the map of the script it refers to; a breakpoint set before
        // that script is parsed has no map yet and is passed through.
        const known = url ? this.#scriptIdsByUrl.$get(url) : urlRegex ? this.#scriptIdMatching(urlRegex) : undefined;
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
        } else {
          this.#replyErrorToClient(id, -32602, "Either url or urlRegex must be specified.");
          return;
        }
        if (known === undefined) {
          // No script (and so no map) yet: remember the original coordinates
          // so the breakpoint can be re-set through the map at scriptParsed.
          this.#sendToBackend("Debugger.setBreakpointByUrl", jscParams, null, method, (result, error) => {
            if (error) {
              this.#replyErrorToClient(id, error.code ?? -32000, error.message ?? "Unknown error");
              return;
            }
            const breakpointId = result.breakpointId;
            if (typeof breakpointId === "string") {
              this.#preParseBreakpoints.$set(breakpointId, {
                jscId: breakpointId,
                url,
                urlRegex,
                lineNumber: params.lineNumber ?? 0,
                columnNumber: params.columnNumber,
                condition,
                resolved: false,
              });
            }
            this.#replyToClient(id, this.#translateResult(method, result));
          });
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
        this.#sendToBackend(
          "Debugger.getBreakpointLocations",
          { start: this.#toGeneratedLocation(start), end: this.#toGeneratedLocation(end) },
          id,
          method,
        );
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
      // Accepted and ignored. Bun can set a sampling interval
      // (Bun__setSamplingInterval), but Profiler.start has no translation and
      // is rejected as unknown, so no profile can observe the difference.
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
        // Node's RuntimeAgent keeps this per session and, at exit, sends this
        // session waitingForDisconnect instead of executionContextDestroyed.
        // Setting it after the handshake has begun is inert, as in Node:
        // retaining_context_ was already taken.
        this.#notifyWhenWaitingForDisconnect = !!params.enabled;
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
          // The client is told the shape of the original file, not of the
          // transpiler's output, and is not handed Bun's map for it.
          const lastNewline = source.lastIndexOf("\n");
          endLine = 0;
          for (let at = source.indexOf("\n"); at >= 0; at = source.indexOf("\n", at + 1)) endLine++;
          endColumn = source.length - lastNewline - 1;
          sourceMapURL = ownSourceMappingURL(source);
        }
        this.#scripts.$set(params.scriptId, {
          cdpUrl,
          endLine,
          endColumn,
          source,
          mappings: source === undefined ? undefined : decoded!.mappings,
          map: undefined,
        });
        if (url) this.#scriptIdsByUrl.$set(url, params.scriptId);
        if (cdpUrl) this.#scriptIdsByUrl.$set(cdpUrl, params.scriptId);
        this.#retranslatePreParseBreakpoints(url, cdpUrl, params.scriptId);
        this.#emitToClient("Debugger.scriptParsed", {
          scriptId: params.scriptId,
          url: cdpUrl,
          startLine: params.startLine ?? 0,
          startColumn: params.startColumn ?? 0,
          endLine,
          endColumn,
          executionContextId: EXECUTION_CONTEXT_ID,
          hash: "",
          isModule: !!params.module,
          sourceMapURL,
          embedderName: cdpUrl,
          scriptLanguage: "JavaScript",
        });
        return;
      }

      case "Debugger.paused": {
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
        this.#emitToClient("Debugger.resumed", {});
        return;

      case "Debugger.breakpointResolved":
        this.#emitToClient("Debugger.breakpointResolved", {
          breakpointId: this.#toClientBreakpointId(params.breakpointId),
          location: this.#toOriginalLocation(params.location),
        });
        return;

      case "Debugger.globalObjectCleared":
        this.#emitToClient("Runtime.executionContextsCleared", {});
        return;

      case "Console.messageAdded":
        this.#translateConsoleMessage(params.message || {});
        return;

      case "Bun.waitingForDisconnect":
        // The inspected thread reached exit and is blocking for this frontend.
        // Node: sessions that opted in get waitingForDisconnect; if *any*
        // session opted in, the rest get nothing yet — the context is still
        // live enough to answer Runtime.evaluate, so they only see it destroyed
        // once the last retaining session disconnects.
        this.#startHandshakeOnce();
        if (this.#retainingContext) {
          this.#emitToClient("NodeRuntime.waitingForDisconnect", {});
        } else if (this.#disconnectNotify.retaining === 0) {
          this.#emitContextDestroyed();
        }
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
    const frames: AnyObject[] = stackTrace.callFrames ?? [];
    // The boundary frame is a label, not a location: hand it to the client as
    // `description` the way V8 does instead of leaving it in the frame list.
    const boundary = stackTrace.topCallFrameIsBoundary && frames.length ? frames[0] : undefined;
    const description = boundary ? ASYNC_BOUNDARY_DESCRIPTIONS[boundary.functionName ?? ""] : undefined;
    const translated: AnyObject = {
      callFrames: (boundary ? frames.slice(1) : frames).map((frame: AnyObject) => {
        const scriptId = frame.scriptId ?? this.#scriptIdsByUrl.$get(frame.url ?? "") ?? "";
        // JSC counts these lines and columns from 1; CDP counts from 0.
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
    if (description !== undefined) translated.description = description;
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
        scriptId: this.#scriptIdsByUrl.$get(message.url ?? ""),
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
  EXECUTION_CONTEXT_ID,
};
