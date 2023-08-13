const headerInvalidNumber = 2147483646;

// We use non-printable characters to separate messages in the stream.
// These should never appear in textual messages.

// These are non-sequential so that code which just counts up from 0 doesn't accidentally parse them as messages.
// 0x12 0x11 0x13 0x14 as a little-endian 32-bit unsigned integer
const headerPrefix = "\x14\x13\x11\x12";

// 0x14 0x12 0x13 0x11 as a little-endian 32-bit unsigned integer
const headerSuffixString = "\x11\x13\x12\x14";

const headerSuffixInt = Buffer.from(headerSuffixString).readInt32LE(0);
const headerPrefixInt = Buffer.from(headerPrefix).readInt32LE(0);

const messageLengthBuffer = new ArrayBuffer(12);
const messageLengthDataView = new DataView(messageLengthBuffer);
messageLengthDataView.setInt32(0, headerPrefixInt, true);
messageLengthDataView.setInt32(8, headerSuffixInt, true);

import type * as BunType from "bun";

function writeJSONMessageToArrayBufferSink(sink: BunType.ArrayBufferSink, message: any) {
  sink.write(messageLengthBuffer);
  const written = sink.write(JSON.stringify(message));
  const outbuffer = sink.flush();
  new DataView(outbuffer as ArrayBuffer).setInt32(4, written, true);
  return outbuffer as ArrayBuffer;
}

function writeJSONMessageToBuffer(message: any) {
  const asString = JSON.stringify(message);
  const byteLength = Buffer.byteLength(asString, "utf8");
  const buffer = new Buffer(12 + byteLength);
  buffer.writeInt32LE(headerPrefixInt, 0);
  buffer.writeInt32LE(byteLength, 4);
  buffer.writeInt32LE(headerSuffixInt, 8);
  if (buffer.write(asString, 12, byteLength, "utf8") !== byteLength) {
    throw new Error("Failed to write message to buffer");
  }

  return buffer;
}

let currentMessageLength = 0;
function extractMessageLengthAndOffsetFromBytes(buffer: Buffer, offset: number) {
  const bufferLength = buffer.byteLength;
  while (offset < bufferLength) {
    const headerStart = buffer.indexOf(headerPrefix, offset, "binary");
    if (headerStart === -1) {
      return headerInvalidNumber;
    }

    // [headerPrefix (4), byteLength (4), headerSuffix (4)]
    if (buffer.byteLength < headerStart + 12) {
      return headerInvalidNumber;
    }

    const prefix = buffer.readInt32LE(headerStart);
    const byteLengthInt = buffer.readInt32LE(headerStart + 4);
    const suffix = buffer.readInt32LE(headerStart + 8);

    if (prefix !== headerPrefixInt || suffix !== headerSuffixInt) {
      offset = headerStart + 1;
      currentMessageLength = 0;
      continue;
    }

    if (byteLengthInt < 0) {
      return headerInvalidNumber;
    }

    if (byteLengthInt === 0) {
      // Ignore 0-length messages
      // Shouldn't happen in practice
      offset = headerStart + 12;
      currentMessageLength = 0;
      continue;
    }

    currentMessageLength = byteLengthInt;
    return headerStart + 12;
  }

  return headerInvalidNumber;
}

class StreamingJSONReader {
  pendingBuffer: Buffer;

  constructor() {
    this.pendingBuffer = new Buffer(0);
  }

  *onMessage(chunk: Uint8Array) {
    let buffer: Buffer;
    if (this.pendingBuffer.length > 0) {
      this.pendingBuffer = buffer = Buffer.concat([this.pendingBuffer, new Buffer(chunk.buffer)]);
    } else {
      this.pendingBuffer = buffer = new Buffer(chunk.buffer);
    }

    for (let offset = extractMessageLengthAndOffsetFromBytes(buffer, 0); offset !== headerInvalidNumber; ) {
      const messageLength = currentMessageLength;
      const start = offset;
      const end = start + messageLength;
      offset = end + 1;
      const messageChunk = buffer.slice(start, end);
      this.pendingBuffer = buffer = buffer.slice(offset);
      yield JSON.parse(messageChunk.toString());
    }
  }
}

import {
  ContinuedEvent,
  ExitedEvent,
  InitializedEvent,
  LoadedSourceEvent,
  LoggingDebugSession,
  OutputEvent,
  Source,
  StoppedEvent,
  TerminatedEvent,
  Thread,
} from "@vscode/debugadapter";
import type { DebugProtocol as DAP } from "@vscode/debugprotocol";
import type { JSC } from "../../../packages/bun-vscode/types/jsc.d.ts";
const { Readable, Writable } = require("node:stream");

class JavaScriptCoreInspector {
  #requestId: number;
  #pendingRequests: Map<number, (result: unknown) => void>;

  constructor(public sendMessage: (msg: string) => void) {
    this.#requestId = 1;
    this.#pendingRequests = new Map();
  }

  onResponse(msg: JSC.Response) {
    const { id } = msg;
    const done = this.#pendingRequests.get(id);
    this.#pendingRequests.delete(id);

    if ("error" in msg) {
      const { message, code = "?" } = msg.error;
      const error = new Error(`${message} [code: ${code}]`);
      done?.(error);
    } else {
      done?.(msg.result);
    }
  }

  async fetch<T extends keyof JSC.RequestMap>(
    method: T,
    params?: JSC.Request<T>["params"],
  ): Promise<JSC.ResponseMap[T]> {
    const id = this.#requestId++;
    const request: JSC.Request<T> = {
      id,
      method,
      params,
    };

    const { resolve, reject, promise } = Promise.withResolvers();
    const done = (result: Error | JSC.ResponseMap[T]) => {
      this.#pendingRequests.delete(id);
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    this.#pendingRequests.set(id, done as any);
    this.sendMessage(JSON.stringify(request));
    return await promise;
  }
}

interface Listener {
  debugger: Debugger;

  write(msg: object): void;
}

class FileListener implements Listener {
  debugger: Debugger;
  writer: BunType.FileSink;
  writeSink: BunType.ArrayBufferSink;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  streamingJSONReader: StreamingJSONReader;

  constructor(d: Debugger, pathOrFileURL: string) {
    this.debugger = d;
    if (pathOrFileURL.startsWith("file://")) {
      pathOrFileURL = Bun.fileURLToPath(pathOrFileURL as any);
    }

    const file = Bun.file(pathOrFileURL);
    this.writer = file.writer();
    this.reader = file.stream().getReader();
    this.streamingJSONReader = new StreamingJSONReader();
    this.writeSink = new Bun.ArrayBufferSink();
    this.writeSink.start({
      highWaterMark: 4096,
      stream: true,
    });
  }

  async write(msg: object) {
    const { writer, writeSink } = this;
    writeJSONMessageToArrayBufferSink(writeSink, msg);
    writer.write(writeSink.flush() as ArrayBuffer);
    const prom = writer.flush();
    if (typeof prom !== "number") {
      await prom;
    }
  }

  startReading() {
    this.consume().$catch(e => {
      console.error("DEBUGGER", e);
    });
  }

  async consume() {
    var { reader, streamingJSONReader } = this;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      for (const msg of streamingJSONReader.onMessage(value as Uint8Array)) {
        this.debugger.onDAPMessage(msg);
      }
    }
  }
}

const capabilities: Required<DAP.Capabilities> = {
  /** The debug adapter supports the `configurationDone` request. */
  supportsConfigurationDoneRequest: true,
  /** The debug adapter supports function breakpoints. */
  supportsFunctionBreakpoints: true,
  /** The debug adapter supports conditional breakpoints. */
  supportsConditionalBreakpoints: true,
  /** The debug adapter supports breakpoints that break execution after a specified number of hits. */
  supportsHitConditionalBreakpoints: true, // TODO
  /** The debug adapter supports a (side effect free) `evaluate` request for data hovers. */
  supportsEvaluateForHovers: true,
  /** Available exception filter options for the `setExceptionBreakpoints` request. */
  exceptionBreakpointFilters: [],
  /** The debug adapter supports stepping back via the `stepBack` and `reverseContinue` requests. */
  supportsStepBack: false,
  /** The debug adapter supports setting a variable to a value. */
  supportsSetVariable: false, // TODO
  /** The debug adapter supports restarting a frame. */
  supportsRestartFrame: false, // TODO
  /** The debug adapter supports the `gotoTargets` request. */
  supportsGotoTargetsRequest: false, // TODO
  /** The debug adapter supports the `stepInTargets` request. */
  supportsStepInTargetsRequest: false, // TODO
  /** The debug adapter supports the `completions` request. */
  supportsCompletionsRequest: false, // TODO
  /** The set of characters that should trigger completion in a REPL. If not specified, the UI should assume the `.` character. */
  completionTriggerCharacters: [".", "[", '"', "'"],
  /** The debug adapter supports the `modules` request. */
  supportsModulesRequest: true,
  /** The set of additional module information exposed by the debug adapter. */
  additionalModuleColumns: [],
  /** Checksum algorithms supported by the debug adapter. */
  supportedChecksumAlgorithms: [],
  /** The debug adapter supports the `restart` request. In this case a client should not implement `restart` by terminating and relaunching the adapter but by calling the `restart` request. */
  supportsRestartRequest: false,
  /** The debug adapter supports `exceptionOptions` on the `setExceptionBreakpoints` request. */
  supportsExceptionOptions: true,
  /** The debug adapter supports a `format` attribute on the `stackTrace`, `variables`, and `evaluate` requests. */
  supportsValueFormattingOptions: false, // TODO
  /** The debug adapter supports the `exceptionInfo` request. */
  supportsExceptionInfoRequest: true,
  /** The debug adapter supports the `terminateDebuggee` attribute on the `disconnect` request. */
  supportTerminateDebuggee: true,
  /** The debug adapter supports the `suspendDebuggee` attribute on the `disconnect` request. */
  supportSuspendDebuggee: false,
  /** The debug adapter supports the delayed loading of parts of the stack, which requires that both the `startFrame` and `levels` arguments and the `totalFrames` result of the `stackTrace` request are supported. */
  supportsDelayedStackTraceLoading: true,
  /** The debug adapter supports the `loadedSources` request. */
  supportsLoadedSourcesRequest: true,
  /** The debug adapter supports log points by interpreting the `logMessage` attribute of the `SourceBreakpoint`. */
  supportsLogPoints: true,
  /** The debug adapter supports the `terminateThreads` request. */
  supportsTerminateThreadsRequest: false,
  /** The debug adapter supports the `setExpression` request. */
  supportsSetExpression: false, // TODO
  /** The debug adapter supports the `terminate` request. */
  supportsTerminateRequest: true,
  /** The debug adapter supports data breakpoints. */
  supportsDataBreakpoints: true,
  /** The debug adapter supports the `readMemory` request. */
  supportsReadMemoryRequest: false,
  /** The debug adapter supports the `writeMemory` request. */
  supportsWriteMemoryRequest: false,
  /** The debug adapter supports the `disassemble` request. */
  supportsDisassembleRequest: false,
  /** The debug adapter supports the `cancel` request. */
  supportsCancelRequest: false,
  /** The debug adapter supports the `breakpointLocations` request. */
  supportsBreakpointLocationsRequest: true,
  /** The debug adapter supports the `clipboard` context value in the `evaluate` request. */
  supportsClipboardContext: false, // TODO
  /** The debug adapter supports stepping granularities (argument `granularity`) for the stepping requests. */
  supportsSteppingGranularity: false, // TODO
  /** The debug adapter supports adding breakpoints based on instruction references. */
  supportsInstructionBreakpoints: true,
  /** The debug adapter supports `filterOptions` as an argument on the `setExceptionBreakpoints` request. */
  supportsExceptionFilterOptions: false, // TODO
  /** The debug adapter supports the `singleThread` property on the execution requests (`continue`, `next`, `stepIn`, `stepOut`, `reverseContinue`, `stepBack`). */
  supportsSingleThreadExecutionRequests: false,
};

const nodejsCapabilities: DAP.Capabilities = {
  supportsConfigurationDoneRequest: true,
  supportsFunctionBreakpoints: false,
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: true,
  supportsEvaluateForHovers: true,
  supportsReadMemoryRequest: true,
  supportsWriteMemoryRequest: true,
  exceptionBreakpointFilters: [
    {
      filter: "all",
      label: "Caught Exceptions",
      default: false,
      supportsCondition: true,
      description: "Breaks on all throw errors, even if they're caught later.",
      conditionDescription: `error.name == "MyError"`,
    },
    {
      filter: "uncaught",
      label: "Uncaught Exceptions",
      default: false,
      supportsCondition: true,
      description: "Breaks only on errors or promise rejections that are not handled.",
      conditionDescription: `error.name == "MyError"`,
    },
  ],
  supportsStepBack: false,
  supportsSetVariable: true,
  supportsRestartFrame: true,
  supportsGotoTargetsRequest: false,
  supportsStepInTargetsRequest: true,
  supportsCompletionsRequest: true,
  supportsModulesRequest: false,
  additionalModuleColumns: [],
  supportedChecksumAlgorithms: [],
  supportsRestartRequest: true,
  supportsExceptionOptions: false,
  supportsValueFormattingOptions: true,
  supportsExceptionInfoRequest: true,
  supportTerminateDebuggee: true,
  supportsDelayedStackTraceLoading: true,
  supportsLoadedSourcesRequest: true,
  supportsLogPoints: true,
  supportsTerminateThreadsRequest: false,
  supportsSetExpression: true,
  supportsTerminateRequest: false,
  completionTriggerCharacters: [".", "[", '"', "'"],
  supportsBreakpointLocationsRequest: true,
  supportsClipboardContext: true,
  supportsExceptionFilterOptions: true,
  //supportsEvaluationOptions: extended ? true : false,
  //supportsDebuggerProperties: extended ? true : false,
  //supportsSetSymbolOptions: extended ? true : false,
  //supportsDataBreakpoints: false,
  //supportsDisassembleRequest: false,
};

type LaunchRequestArguments = DAP.LaunchRequestArguments & {
  program: string;
};

type AttachRequestArguments = DAP.AttachRequestArguments & {
  url?: string;
  port?: number;
};

class DAPAdapter extends LoggingDebugSession implements Context {
  #thread?: DAP.Thread;
  #ready: AbortController;
  #sources: Map<string, DAP.Source>;
  #stackFrames: DAP.StackFrame[];
  #scopes: Map<number, DAP.Scope[]>;

  public constructor(public jsc: JavaScriptCoreInspector) {
    super();
    this.#ready = new AbortController();
    this.#sources = new Map();
    this.#stackFrames = [];
    this.#scopes = new Map();
    // 1-based lines and columns
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(false);
  }

  #ack<R extends DAP.Response = DAP.Response>(response: R, extra?: Partial<R>["body"]): void {
    this.sendResponse({ ...response, body: extra, success: true });
  }

  #nack(response: DAP.Response, error?: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.sendResponse({ ...response, success: false, message });
  }

  #todo(response: DAP.Response, label: string): void {
    this.#nack(response, `TODO: ${label}`);
  }

  #noop(response: DAP.Response, label: string): void {
    this.#nack(response, `Not supported: ${label}`);
  }

  async #send<R extends DAP.Response, T extends keyof JSC.RequestMap>(
    response: R,
    method: T,
    params?: JSC.Request<T>["params"],
    callback?: (result: JSC.ResponseMap[T]) => Partial<R["body"]> | void,
  ) {
    try {
      const result = await this.jsc.fetch(method, params);
      const ack = callback?.(result);
      if (ack) {
        this.#ack(response, ack);
      } else {
        this.#ack(response);
      }
    } catch (error) {
      console.error(error);
      this.#nack(response, error);
    }
  }

  getReferenceId(objectId: string): number {
    try {
      const { injectedScriptId, id } = JSON.parse(objectId);
      const referenceId = Number(`${injectedScriptId}${id}`);
      if (isNaN(referenceId)) {
        throw new Error();
      }
      return referenceId;
    } catch {
      return hashCode(objectId);
    }
  }

  getObjectId(referenceId: number): string {
    const objectId = String(referenceId);
    try {
      const injectedScriptId = Number(objectId.slice(0, 1));
      const id = Number(objectId.slice(1));
      return JSON.stringify({ injectedScriptId, id });
    } catch {
      return objectId;
    }
  }

  getStackFrameId(callFrameId: string): number {
    try {
      const { injectedScriptId, ordinal } = JSON.parse(callFrameId);
      const frameId = Number(`${injectedScriptId}${ordinal}`);
      if (isNaN(frameId)) {
        throw new Error();
      }
      return frameId;
    } catch {
      return hashCode(callFrameId);
    }
  }

  getCallFrameId(stackFrameId: number): string {
    const objectId = String(stackFrameId);
    try {
      const injectedScriptId = Number(objectId.slice(0, 1));
      const ordinal = Number(objectId.slice(1));
      return JSON.stringify({ injectedScriptId, ordinal });
    } catch {
      return objectId;
    }
  }

  getSource(scriptId: string): DAP.Source | undefined {
    return this.#sources.get(scriptId);
  }

  getModuleId(scriptId: string): number | undefined {
    return undefined; // TODO
  }

  async getProperties(objectId: string): Promise<JSC.Runtime.PropertyDescriptor[]> {
    const { properties } = await this.jsc.fetch("Runtime.getProperties", {
      objectId,
    });
    let hasEntries = false;
    for (const { name } of properties) {
      if (name === "entries") {
        hasEntries = true;
      }
      // HACK: Do not call on arrays, as it appears to error the debugger.
      // Internal error [code: -32000]
      if (name === "at") {
        hasEntries = false;
        break;
      }
    }
    if (!hasEntries) {
      return properties;
    }
    const { entries } = await this.jsc.fetch("Runtime.getCollectionEntries", {
      objectId,
    });
    const results: JSC.Runtime.PropertyDescriptor[] = [...properties.reverse()];
    for (let i = entries.length - 1; i >= 0; i--) {
      const { key, value } = entries[i];
      results.push({
        name: key?.description ?? `${i}`,
        value,
      });
    }
    return results.reverse();
  }

  onEvent(event: JSC.Event): void {
    console.log(Date.now(), "JSC Event:", event);
    const { method, params } = event;
    this[method]?.(params);
  }

  protected ["Debugger.scriptParsed"](event: JSC.Debugger.ScriptParsedEvent): void {
    const { url, scriptId } = event;
    if (!url) {
      return; // If the script has no URL, it is an `eval` command.
    }

    // const name = vscode.workspace.asRelativePath(url);
    const source = new Source(url, url, hashCode(event.scriptId));
    source.sourceReference = hashCode(event.scriptId);
    this.#sources.set(scriptId, source);
    this.sendEvent(new LoadedSourceEvent("new", source));
  }

  protected ["Debugger.paused"](event: JSC.Debugger.PausedEvent): void {
    const { reason, callFrames, asyncStackTrace } = event;
    const [{ location }] = callFrames;
    const { scriptId } = location;
    this.sendEvent(new StoppedEvent(reason === "PauseOnNextStatement" ? "pause" : "breakpoint", Number(scriptId)));
    const stackFrames: DAP.StackFrame[] = [];
    const scopes: Map<number, DAP.Scope[]> = new Map();
    for (const callFrame of callFrames) {
      const stackFrame = formatStackFrame(this, callFrame);
      stackFrames.push(stackFrame);
      const frameScopes: DAP.Scope[] = [];
      for (const scope of callFrame.scopeChain) {
        frameScopes.push(...formatScope(this, scope));
      }
      scopes.set(stackFrame.id, frameScopes);
    }
    this.#scopes = scopes;
    this.#stackFrames = stackFrames;
  }

  protected ["Debugger.resumed"](event: JSC.Debugger.ResumedEvent): void {
    this.sendEvent(new ContinuedEvent(0, true));
  }

  handleMessage(message: DAP.ProtocolMessage): void {
    console.log(Date.now(), "DAP Request:", message);
    super.handleMessage(message);
  }

  sendResponse(response: DAP.Response): void {
    console.log(Date.now(), "DAP Response:", response);
    super.sendResponse(response);
  }

  sendEvent(event: DAP.Event): void {
    console.log(Date.now(), "DAP Event:", event);
    super.sendEvent(event);
  }

  runInTerminalRequest(
    args: DAP.RunInTerminalRequestArguments,
    timeout: number,
    cb: (response: DAP.RunInTerminalResponse) => void,
  ): void {
    // TODO
  }

  protected initializeRequest(response: DAP.InitializeResponse, args: DAP.InitializeRequestArguments): void {
    this.#ack(response, nodejsCapabilities);
    this.sendEvent(new InitializedEvent());
  }

  protected async disconnectRequest(
    response: DAP.DisconnectResponse,
    args: DAP.DisconnectArguments,
    request?: DAP.Request,
  ): Promise<void> {
    await this.jsc?.fetch("Debugger.disable");
    // const { terminateDebuggee } = args;
    // if (terminateDebuggee) {
    //   this.#process?.kill();
    // }
    await this.#ack(response);
  }

  async #attach(url: string): Promise<void> {}

  protected async launchRequest(
    response: DAP.LaunchResponse,
    args: LaunchRequestArguments,
    request?: DAP.Request,
  ): Promise<void> {
    await new Promise<void>(resolve => {
      if (this.#ready.signal.aborted) {
        resolve();
        return;
      }
      this.#ready.signal.addEventListener("abort", () => {
        resolve();
      });
    });
    try {
      this.#ack(response);
    } catch (error) {
      this.#nack(response, error);
    }
  }

  protected async attachRequest(
    response: DAP.AttachResponse,
    args: AttachRequestArguments,
    request?: DAP.Request,
  ): Promise<void> {
    const { url, port } = args;
    try {
      this.#ack(response);
    } catch (error) {
      this.#nack(response, error);
    }
  }

  protected terminateRequest(
    response: DAP.TerminateResponse,
    args: DAP.TerminateArguments,
    request?: DAP.Request,
  ): void {
    // this.jsc?.close();
    this.sendEvent(new TerminatedEvent());
    this.#ack(response);
  }

  protected restartRequest(response: DAP.RestartResponse, args: DAP.RestartArguments, request?: DAP.Request): void {
    this.#noop(response, "restartRequest");
  }

  protected async setBreakPointsRequest(
    response: DAP.SetBreakpointsResponse,
    args: DAP.SetBreakpointsArguments,
    request?: DAP.Request,
  ): Promise<void> {
    if (!args.breakpoints?.length) {
      this.#nack(response, "No breakpoints");
      return;
    }
    const { source, breakpoints } = args;
    const results: DAP.Breakpoint[] = await Promise.all(
      breakpoints.map(({ line, column }) =>
        this.jsc
          .fetch("Debugger.setBreakpoint", {
            location: {
              scriptId: String(source.sourceReference), // FIXME
              lineNumber: line,
              columnNumber: column,
            },
          })
          .then(({ breakpointId, actualLocation }) => ({
            id: Number(breakpointId),
            line: actualLocation.lineNumber,
            column: actualLocation.columnNumber,
            verified: true,
          })),
      ),
    );
    this.#ack(response, { breakpoints: results });
  }

  protected setFunctionBreakPointsRequest(
    response: DAP.SetFunctionBreakpointsResponse,
    args: DAP.SetFunctionBreakpointsArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "setFunctionBreakPointsRequest");
  }

  protected setExceptionBreakPointsRequest(
    response: DAP.SetExceptionBreakpointsResponse,
    args: DAP.SetExceptionBreakpointsArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "setExceptionBreakPointsRequest");
  }

  protected configurationDoneRequest(
    response: DAP.ConfigurationDoneResponse,
    args: DAP.ConfigurationDoneArguments,
    request?: DAP.Request,
  ): void {
    super.configurationDoneRequest(response, args, request);
    this.#ready.abort();
    // this.#ack(response);
  }

  protected async continueRequest(
    response: DAP.ContinueResponse,
    args: DAP.ContinueArguments,
    request?: DAP.Request,
  ): Promise<void> {
    await this.#send(response, "Debugger.resume");
  }

  protected async nextRequest(
    response: DAP.NextResponse,
    args: DAP.NextArguments,
    request?: DAP.Request,
  ): Promise<void> {
    await this.#send(response, "Debugger.stepNext");
  }

  protected async stepInRequest(
    response: DAP.StepInResponse,
    args: DAP.StepInArguments,
    request?: DAP.Request,
  ): Promise<void> {
    await this.#send(response, "Debugger.stepInto");
  }

  protected async stepOutRequest(
    response: DAP.StepOutResponse,
    args: DAP.StepOutArguments,
    request?: DAP.Request,
  ): Promise<void> {
    await this.#send(response, "Debugger.stepOut");
  }

  protected stepBackRequest(response: DAP.StepBackResponse, args: DAP.StepBackArguments, request?: DAP.Request): void {
    this.#todo(response, "stepBackRequest");
  }

  protected reverseContinueRequest(
    response: DAP.ReverseContinueResponse,
    args: DAP.ReverseContinueArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "reverseContinueRequest");
  }

  protected restartFrameRequest(
    response: DAP.RestartFrameResponse,
    args: DAP.RestartFrameArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "restartFrameRequest");
  }

  protected gotoRequest(response: DAP.GotoResponse, args: DAP.GotoArguments, request?: DAP.Request): void {
    this.#todo(response, "gotoRequest");
  }

  protected pauseRequest(response: DAP.PauseResponse, args: DAP.PauseArguments, request?: DAP.Request): void {
    this.#send(response, "Debugger.pause");
  }

  protected async sourceRequest(
    response: DAP.SourceResponse,
    args: DAP.SourceArguments,
    request?: DAP.Request,
  ): Promise<void> {
    const { sourceReference } = args;
    const scriptId = String(sourceReference);
    await this.#send(response, "Debugger.getScriptSource", { scriptId }, ({ scriptSource }) => ({
      content: scriptSource,
    }));
  }

  protected threadsRequest(response: DAP.ThreadsResponse, request?: DAP.Request): void {
    if (this.#thread) {
      this.#ack(response, { threads: [this.#thread] });
    } else {
      this.#ack(response, { threads: [] });
    }
  }

  protected terminateThreadsRequest(
    response: DAP.TerminateThreadsResponse,
    args: DAP.TerminateThreadsArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "terminateThreadsRequest");
  }

  protected stackTraceRequest(
    response: DAP.StackTraceResponse,
    args: DAP.StackTraceArguments,
    request?: DAP.Request,
  ): void {
    const totalFrames = this.#stackFrames.length;
    const { startFrame = 0, levels = totalFrames } = args;
    this.#ack(response, {
      stackFrames: this.#stackFrames.slice(startFrame, Math.min(totalFrames, startFrame + levels)),
      totalFrames,
    });
  }

  protected scopesRequest(response: DAP.ScopesResponse, args: DAP.ScopesArguments, request?: DAP.Request): void {
    const { frameId } = args;
    const scopes = this.#scopes.get(frameId) ?? [];
    this.#ack(response, { scopes });
  }

  protected async variablesRequest(
    response: DAP.VariablesResponse,
    args: DAP.VariablesArguments,
    request?: DAP.Request,
  ): Promise<void> {
    const { variablesReference } = args;
    const objectId = this.getObjectId(variablesReference);
    try {
      const variables = await formatObject(this, objectId);
      this.#ack(response, { variables });
    } catch (error) {
      this.#nack(response, error);
    }
  }

  protected setVariableRequest(
    response: DAP.SetVariableResponse,
    args: DAP.SetVariableArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "setVariableRequest");
  }

  protected setExpressionRequest(
    response: DAP.SetExpressionResponse,
    args: DAP.SetExpressionArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "setExpressionRequest");
  }

  protected async evaluateRequest(
    response: DAP.EvaluateResponse,
    args: DAP.EvaluateArguments,
    request?: DAP.Request,
  ): Promise<void> {
    const { context, expression, frameId } = args;
    if (frameId) {
    }
    await this.#send(
      response,
      "Runtime.evaluate",
      {
        expression,
        includeCommandLineAPI: true,
      },
      ({ result: { objectId, value, description }, wasThrown }) => {
        return {
          result: value ?? description,
          variablesReference: objectId ? this.getReferenceId(objectId) : 0,
        };
      },
    );
  }

  protected stepInTargetsRequest(
    response: DAP.StepInTargetsResponse,
    args: DAP.StepInTargetsArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "stepInTargetsRequest");
  }

  protected gotoTargetsRequest(
    response: DAP.GotoTargetsResponse,
    args: DAP.GotoTargetsArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "gotoTargetsRequest");
  }

  protected completionsRequest(
    response: DAP.CompletionsResponse,
    args: DAP.CompletionsArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "completionsRequest");
  }

  protected exceptionInfoRequest(
    response: DAP.ExceptionInfoResponse,
    args: DAP.ExceptionInfoArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "exceptionInfoRequest");
  }

  protected loadedSourcesRequest(
    response: DAP.LoadedSourcesResponse,
    args: DAP.LoadedSourcesArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "loadedSourcesRequest");
  }

  protected dataBreakpointInfoRequest(
    response: DAP.DataBreakpointInfoResponse,
    args: DAP.DataBreakpointInfoArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "dataBreakpointInfoRequest");
  }

  protected setDataBreakpointsRequest(
    response: DAP.SetDataBreakpointsResponse,
    args: DAP.SetDataBreakpointsArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "setDataBreakpointsRequest");
  }

  protected readMemoryRequest(
    response: DAP.ReadMemoryResponse,
    args: DAP.ReadMemoryArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "readMemoryRequest");
  }

  protected writeMemoryRequest(
    response: DAP.WriteMemoryResponse,
    args: DAP.WriteMemoryArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "writeMemoryRequest");
  }

  protected disassembleRequest(
    response: DAP.DisassembleResponse,
    args: DAP.DisassembleArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "disassembleRequest");
  }

  protected cancelRequest(response: DAP.CancelResponse, args: DAP.CancelArguments, request?: DAP.Request): void {
    this.#todo(response, "cancelRequest");
  }

  protected async breakpointLocationsRequest(
    response: DAP.BreakpointLocationsResponse,
    args: DAP.BreakpointLocationsArguments,
    request?: DAP.Request,
  ): Promise<void> {
    const {
      line,
      endLine,
      column,
      endColumn,
      source: { path, sourceReference },
    } = args;

    let scriptId: string = "";

    if (sourceReference) {
      scriptId = String(sourceReference);
    } else if (path) {
      for (const [id, source] of this.#sources) {
        if (source.path === path) {
          scriptId = id;
          break;
        }
      }
    }
    if (!scriptId) {
      this.#nack(response, new Error("Either source.path or source.sourceReference must be specified"));
      return;
    }
    await this.#send(
      response,
      "Debugger.getBreakpointLocations",
      {
        start: {
          scriptId,
          lineNumber: line,
          columnNumber: column,
        },
        end: {
          scriptId,
          lineNumber: endLine ?? line + 1,
          columnNumber: endColumn,
        },
      },
      ({ locations }) => {
        return {
          breakpoints: locations.map(({ lineNumber, columnNumber }) => ({
            line: lineNumber,
            //column: columnNumber,
          })),
        };
      },
    );
  }

  protected setInstructionBreakpointsRequest(
    response: DAP.SetInstructionBreakpointsResponse,
    args: DAP.SetInstructionBreakpointsArguments,
    request?: DAP.Request,
  ): void {
    this.#todo(response, "setInstructionBreakpointsRequest");
  }

  protected customRequest(command: string, response: DAP.Response, args: any, request?: DAP.Request): void {
    super.customRequest(command, response, args, request);
  }

  protected convertClientLineToDebugger(line: number): number {
    return line;
  }

  protected convertDebuggerLineToClient(line: number): number {
    return line;
  }

  protected convertClientColumnToDebugger(column: number): number {
    return column;
  }

  protected convertDebuggerColumnToClient(column: number): number {
    return column;
  }

  protected convertClientPathToDebugger(clientPath: string): string {
    return clientPath;
  }

  protected convertDebuggerPathToClient(debuggerPath: string): string {
    return debuggerPath;
  }
}

function hashCode(string: string): number {
  let hash = 0,
    i,
    chr;
  if (string.length === 0) return hash;
  for (i = 0; i < string.length; i++) {
    chr = string.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

interface Context {
  getReferenceId(objectId: string): number;
  getObjectId(referenceId: number): string;
  getStackFrameId(callFrameId: string): number;
  getCallFrameId(stackFrameId: number): string;
  getSource(scriptId: string): DAP.Source | undefined;
  getModuleId(scriptId: string): number | undefined;
  getProperties(objectId: string): Promise<JSC.Runtime.PropertyDescriptor[]>;
}

function formatStackFrame(ctx: Context, callFrame: JSC.Debugger.CallFrame): DAP.StackFrame {
  const { callFrameId, functionName, location } = callFrame;
  const { scriptId, lineNumber, columnNumber = 0 } = location;
  return {
    id: ctx.getStackFrameId(callFrameId),
    name: functionName,
    line: lineNumber,
    column: columnNumber,
    source: ctx.getSource(scriptId),
    moduleId: ctx.getModuleId(scriptId),
  };
}

function formatScope(ctx: Context, scope: JSC.Debugger.Scope): DAP.Scope[] {
  const { name, type, location, object, empty } = scope;
  if (empty) {
    return [];
  }
  const presentationHint = formatScopeHint(type);
  const title = presentationHint.charAt(0).toUpperCase() + presentationHint.slice(1);
  const displayName = name ? `${title}: ${name}` : title;
  return [
    {
      name: displayName,
      presentationHint,
      expensive: presentationHint === "globals",
      variablesReference: object?.objectId ? ctx.getReferenceId(object.objectId) : 0,
      line: location?.lineNumber,
      column: location?.columnNumber,
      source: location && ctx.getSource(location.scriptId),
    },
  ];
}

function formatScopeHint(type: JSC.Debugger.Scope["type"]): "arguments" | "locals" | "globals" | "" {
  switch (type) {
    case "closure":
      return "locals"; // ?
    case "functionName":
    case "with":
    case "catch":
    case "nestedLexical":
      return "locals";
    case "global":
    case "globalLexicalEnvironment":
      return "globals";
    default:
      return "";
  }
}

async function formatObject(ctx: Context, objectId: JSC.Runtime.RemoteObjectId): Promise<DAP.Variable[]> {
  const properties = await ctx.getProperties(objectId);
  return properties.flatMap(property => formatProperty(ctx, property));
}

function formatProperty(ctx: Context, propertyDescriptor: JSC.Runtime.PropertyDescriptor): DAP.Variable[] {
  const { name, value, get, set, symbol } = propertyDescriptor;
  const variables: DAP.Variable[] = [];
  if (value) {
    variables.push(formatPropertyValue(ctx, name, value));
  }
  return variables;
}

function formatPropertyValue(ctx: Context, name: string, remoteObject: JSC.Runtime.RemoteObject): DAP.Variable {
  const { type, subtype, value, description, objectId } = remoteObject;
  return {
    name,
    value: description ?? "",
    type: subtype ?? type,
    variablesReference: objectId ? ctx.getReferenceId(objectId) : 0,
    presentationHint: value && formatPropertyHint(value),
  };
}

function formatPropertyHint(propertyDescriptor: JSC.Runtime.PropertyDescriptor): DAP.VariablePresentationHint {
  const { value, get, set, configurable, enumerable, writable } = propertyDescriptor;
  const hasGetter = get?.type !== "undefined";
  const hasSetter = set?.type !== "undefined";
  const hint: DAP.VariablePresentationHint = {
    kind: (value && formatPropertyKind(value)) ?? "property",
    attributes: [],
    visibility: "public",
  };
  if (!writable && !hasSetter && hasGetter) {
    hint.attributes!.push("readOnly");
  }
  if (!enumerable && !hasGetter) {
    hint.visibility = "internal";
  }
  return hint;
}

function formatPropertyKind(remoteObject: JSC.Runtime.RemoteObject): DAP.VariablePresentationHint["kind"] {
  const { type, subtype, className } = remoteObject;
  if (type === "function") {
    return "method";
  }
  if (subtype === "class") {
    return "class";
  }
  if (className?.endsWith("Event")) {
    return "event";
  }
  return "property";
}

class Debugger {
  jsc: JavaScriptCoreInspector;
  // listener: Listener;
  adapter: DAPAdapter;
  constructor(public sendMessage: (msg: string) => void, hostOrPort: string) {
    this.jsc = new JavaScriptCoreInspector(this.sendMessage);
    // this.listener = new FileListener(this, hostOrPort);
    this.adapter = new DAPAdapter(this.jsc);
    if (hostOrPort.startsWith("file:")) {
      hostOrPort = Bun.fileURLToPath(hostOrPort as any);
    }

    if (hostOrPort === "") {
      hostOrPort = "localhost:9232";
    }

    if (hostOrPort.includes(":")) {
      const [host, port] = hostOrPort.split(":");
      const net = require("node:net");
      net
        .createServer(socket => {
          this.adapter.start(socket, socket);
        })
        .listen(Number(port), host);
    } else {
      const { createReadStream, createWriteStream } = require("node:fs");
      this.adapter.start(createReadStream(hostOrPort), createWriteStream(hostOrPort));
    }
  }

  send(msg: string) {
    console.log("[inspector] send", msg);
    this.jsc.sendMessage(msg);
  }

  onDAPMessage(msg: any) {}

  onWebKitMessage(...msgs: string[]) {
    const jsc = this.jsc;
    for (var msg of msgs) {
      const parsed = JSON.parse(msg);
      console.log("[inspector] onMessage", msg);
      if ("id" in parsed) {
        jsc.onResponse(parsed);
      } else {
        this.adapter.onEvent(parsed);
      }
    }
  }
}

export default function start(debuggerId, hostOrPort, sendMessageToInspector) {
  var instance = new Debugger(sendMessageToInspector.bind(debuggerId), hostOrPort);
  return instance.onWebKitMessage.bind(instance);
}
