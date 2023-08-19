import type { DAP } from "..";
import type { JSC, InspectorListener } from "../../bun-inspector-protocol";
import { WebSocketInspector } from "../../bun-inspector-protocol";
import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import capabilities from "./capabilities";
import { SourceMap } from "./sourcemap";

type LaunchRequest = DAP.LaunchRequest & {
  runtime?: string;
  program?: string;
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
  inheritEnv?: boolean;
};

type AttachRequest = DAP.AttachRequest & {
  url?: string;
};

type Source = DAP.Source & {
  scriptId: string;
  sourceMap: SourceMap;
} & (
    | {
        sourceId: string;
        path: string;
        sourceReference?: undefined;
      }
    | {
        sourceId: number;
        path?: undefined;
        sourceReference: number;
      }
  );

type Breakpoint = DAP.Breakpoint & {
  id: number;
  breakpointId: string;
  source: Source;
};

type FunctionBreakpoint = DAP.Breakpoint & {
  id: number;
  name: string;
};

type StackFrame = DAP.StackFrame & {
  scriptId: string;
  callFrameId: string;
  source?: Source;
  scopes?: Scope[];
};

type Scope = DAP.Scope & {
  source?: Source;
};

type IDebugAdapter = {
  [E in keyof DAP.EventMap]?: (event: DAP.EventMap[E]) => void;
} & {
  [R in keyof DAP.RequestMap]?: (request: DAP.RequestMap[R]) => DAP.ResponseMap[R] | Promise<DAP.ResponseMap[R]>;
};

export type DebugAdapterOptions = {
  sendToAdapter(message: DAP.Request | DAP.Response | DAP.Event): Promise<void>;
};

// This adapter only support single-threaded debugging,
// which means that there is only one thread at a time.
const threadId = 1;

export class DebugAdapter implements IDebugAdapter, InspectorListener {
  #sendToAdapter: DebugAdapterOptions["sendToAdapter"];
  #inspector: WebSocketInspector;
  #sourceId: number;
  #pendingSources: Map<string, ((source: Source) => void)[]>;
  #sources: Map<string | number, Source>;
  #stackFrames: StackFrame[];
  #stopped?: DAP.StoppedEvent["reason"];
  #breakpointId: number;
  #breakpoints: Breakpoint[];
  #functionBreakpoints: Map<string, FunctionBreakpoint>;
  #variableId: number;
  #variables: Map<number, JSC.Runtime.RemoteObject>;
  #process?: ChildProcess;

  constructor({ sendToAdapter }: DebugAdapterOptions) {
    this.#inspector = new WebSocketInspector({ listener: this });
    this.#sendToAdapter = sendToAdapter;
    this.#sourceId = 1;
    this.#pendingSources = new Map();
    this.#sources = new Map();
    this.#stackFrames = [];
    this.#stopped = undefined;
    this.#breakpointId = 1;
    this.#breakpoints = [];
    this.#functionBreakpoints = new Map();
    this.#variableId = 1;
    this.#variables = new Map();
  }

  #reset(): void {
    this.#pendingSources.clear();
    this.#sources.clear();
    this.#stackFrames.length = 0;
    this.#stopped = undefined;
    this.#breakpointId = 1;
    this.#breakpoints.length = 0;
    this.#functionBreakpoints.clear();
    this.#variableId = 1;
    this.#variables.clear();
  }

  /**
   * Accepts a message from the adapter.
   */
  async accept(message: DAP.Request | DAP.Response | DAP.Event): Promise<void> {
    const { type } = message;

    switch (type) {
      case "request":
        return this.#acceptRequest(message);
    }

    throw new Error(`Not supported: ${type}`);
  }

  async #acceptRequest(request: DAP.Request): Promise<void> {
    const { seq, command, arguments: args } = request;

    let response;
    try {
      if (!(command! in this)) {
        throw new Error(`Not supported: ${command}`);
      }
      response = await this[command as keyof this](args);
    } catch (error) {
      console.error(error);
      const { message } = unknownToError(error);
      return this.#sendToAdapter({
        type: "response",
        success: false,
        message,
        request_seq: seq,
        seq: 0,
        command,
      });
    }

    return this.#sendToAdapter({
      type: "response",
      success: true,
      request_seq: seq,
      seq: 0,
      command,
      body: response,
    });
  }

  /**
   * Closes the inspector and adapter.
   */
  close(): void {
    this.#process?.kill();
    this.#inspector.close();
    this.#reset();
  }

  async #send<M extends keyof JSC.RequestMap & keyof JSC.ResponseMap>(
    method: M,
    params?: JSC.RequestMap[M] & { errorsToIgnore?: string[] },
  ): Promise<JSC.ResponseMap[M]> {
    const { errorsToIgnore, ...options } = params ?? {};

    try {
      // @ts-ignore
      return await this.#inspector.send(method, options);
    } catch (cause) {
      const { message } = unknownToError(cause);
      for (const error of errorsToIgnore ?? []) {
        if (message.includes(error)) {
          console.warn("Ignored error:", message);
          // @ts-ignore
          return {};
        }
      }
      throw cause;
    }
  }

  /**
   * Emits an event to the adapter.
   */
  async #emit<E extends keyof DAP.EventMap>(name: E, body?: DAP.EventMap[E]): Promise<void> {
    await this.#sendToAdapter({
      type: "event",
      seq: 0,
      event: name,
      body,
    });
  }

  async initialize(request: DAP.InitializeRequest): Promise<DAP.InitializeResponse> {
    const { clientID, supportsConfigurationDoneRequest } = request as any;

    this.#send("Inspector.enable");
    this.#send("Runtime.enable");
    this.#send("Console.enable");
    this.#send("Debugger.enable");
    this.#send("Debugger.setAsyncStackTraceDepth", { depth: 200 });
    this.#send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
    this.#send("Debugger.setBlackboxBreakpointEvaluations", { blackboxBreakpointEvaluations: true });
    this.#send("Debugger.setBreakpointsActive", { active: true });

    // If the client will send a `configurationDone` request, pause execution
    // until it is received, so any breakpoints can be set before the program continues.
    if (supportsConfigurationDoneRequest || clientID === "vscode") {
      this.#send("Debugger.pause");
      this.#stopped = "entry";
    }

    return capabilities;
  }

  async configurationDone(request: DAP.ConfigurationDoneRequest): Promise<DAP.ConfigurationDoneResponse> {
    // Now that the client has finished configuring the debugger, resume execution.
    if (this.#stopped === "entry") {
      this.#send("Debugger.resume");
      this.#stopped = undefined;
    }

    return {};
  }

  async launch(request: LaunchRequest): Promise<DAP.LaunchResponse> {
    if (this.#process?.exitCode === null) {
      throw new Error("Already running, terminate the previous session first.");
    }

    const { program, runtime = "bun", args = [], cwd, env = {}, inheritEnv = true } = request;
    if (!program) {
      throw new Error("Missing program.");
    }

    if (!isJavaScript(program)) {
      throw new Error("Program must be a JavaScript or TypeScript file.");
    }

    const subprocess = spawn(runtime, ["--inspect=0", ...args, program], {
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      cwd,
      env: inheritEnv ? { ...process.env, ...env } : env,
    });

    subprocess.on("spawn", () => {
      this.#process = subprocess;
      this.#emit("process", {
        name: program,
        systemProcessId: subprocess.pid,
        isLocalProcess: true,
        startMethod: "launch",
      });
    });

    subprocess.on("exit", code => {
      this.#emit("exited", {
        exitCode: code ?? -1,
      });
      this.#process = undefined;
    });

    let stdout: string[] | undefined = [];
    subprocess.stdout!.on("data", data => {
      if (stdout) {
        stdout.push(data.toString());
      }
    });

    let stderr: string[] | undefined = [];
    subprocess.stderr!.on("data", data => {
      if (stderr) {
        stderr.push(data.toString());
      }
    });

    const started = new Promise<undefined>(resolve => {
      subprocess.on("spawn", () => resolve(undefined));
    });

    const exited = new Promise<number | string | Error>(resolve => {
      subprocess.on("exit", (code, signal) => resolve(code ?? signal ?? -1));
      subprocess.on("error", resolve);
    });

    const exitReason = await Promise.race([started, exited]);

    if (exitReason === undefined) {
      let retries = 0;
      while (retries++ < 10) {
        const url = lookForUrl(stdout);
        if (!url) {
          await new Promise(resolve => setTimeout(resolve, 100 * retries));
          continue;
        }

        stdout = undefined;
        stderr = undefined;

        this.#inspector.start(url);
        return {};
      }

      this.#emit("output", {
        category: "debug console",
        output: `Failed to attach to ${program}\n`,
      });
    }

    if (!subprocess.killed && !subprocess.kill() && !subprocess.kill("SIGKILL")) {
      this.#emit("output", {
        category: "debug console",
        output: `Failed to kill process ${subprocess.pid}\n`,
      });
    }

    this.#emit("terminated");

    for (const message of stderr) {
      this.#emit("output", {
        category: "stderr",
        output: message,
        source: {
          path: program,
        },
      });
    }

    if (exitReason instanceof Error) {
      const { message } = exitReason;
      throw new Error(`Failed to launch program: ${message}`);
    }

    const { exitCode } = subprocess;
    throw new Error(`Program exited with code: ${exitCode}`);
  }

  async attach(request: AttachRequest): Promise<DAP.AttachResponse> {
    const { url } = request;

    this.#inspector.start(parseUrl(url));

    return {};
  }

  async terminate(request: DAP.TerminateRequest): Promise<DAP.TerminateResponse> {
    this.#process?.kill();

    return {};
  }

  async disconnect(request: DAP.DisconnectRequest): Promise<DAP.DisconnectResponse> {
    const { terminateDebuggee } = request;

    if (terminateDebuggee) {
      this.#process?.kill();
    }
    this.close();

    return {};
  }

  async loadedSources(request: DAP.LoadedSourcesRequest): Promise<DAP.LoadedSourcesResponse> {
    const sources = new Map();

    // Since there are duplicate keys for each source,
    // (e.g. scriptId, path, sourceReference, etc.) it needs to be deduped.
    for (const source of this.#sources.values()) {
      const { sourceId } = source;
      sources.set(sourceId, source);
    }

    return {
      sources: [...sources.values()],
    };
  }

  async source(request: DAP.SourceRequest): Promise<DAP.SourceResponse> {
    const { source } = request;

    const { scriptId } = await this.#getSource(sourceToId(source));
    const { scriptSource } = await this.#send("Debugger.getScriptSource", { scriptId });

    return {
      content: scriptSource,
    };
  }

  async threads(request: DAP.ThreadsRequest): Promise<DAP.ThreadsResponse> {
    return {
      threads: [
        {
          id: threadId,
          name: "Main Thread",
        },
      ],
    };
  }

  async pause(request: DAP.PauseRequest): Promise<DAP.PauseResponse> {
    const { threadId } = request;

    await this.#send("Debugger.pause");
    this.#stopped = "pause";

    return {};
  }

  async continue(request: DAP.ContinueRequest): Promise<DAP.ContinueResponse> {
    const { threadId } = request;

    await this.#send("Debugger.resume");
    this.#stopped = undefined;

    return {};
  }

  async next(request: DAP.NextRequest): Promise<DAP.NextResponse> {
    const { threadId, granularity } = request;

    await this.#send("Debugger.stepNext");
    this.#stopped = "step";

    return {};
  }

  async stepIn(request: DAP.StepInRequest): Promise<DAP.StepInResponse> {
    const { threadId, granularity } = request;

    await this.#send("Debugger.stepInto");
    this.#stopped = "step";

    return {};
  }

  async stepOut(request: DAP.StepOutRequest): Promise<DAP.StepOutResponse> {
    const { threadId, granularity } = request;

    await this.#send("Debugger.stepOut");
    this.#stopped = "step";

    return {};
  }

  async breakpointLocations(request: DAP.BreakpointLocationsRequest): Promise<DAP.BreakpointLocationsResponse> {
    const { line, endLine, column, endColumn, source: source0 } = request;
    const source = await this.#getSource(sourceToId(source0));

    const [start, end] = await Promise.all([
      this.#generatedLocation(source, line, column),
      this.#generatedLocation(source, endLine ?? line + 1, endColumn),
    ]);

    const { locations } = await this.#send("Debugger.getBreakpointLocations", {
      start,
      end,
    });

    return {
      breakpoints: locations.map(location => this.#originalLocation(source, location)),
    };
  }

  #generatedLocation(source: Source, line?: number, column?: number): JSC.Debugger.Location {
    const { sourceMap, scriptId, path } = source;
    const { line: line0, column: column0 } = sourceMap.generatedPosition(line, column, path);

    return {
      scriptId,
      lineNumber: line0,
      columnNumber: column0,
    };
  }

  #originalLocation(
    source: Source,
    line?: number | JSC.Debugger.Location,
    column?: number,
  ): { line: number; column: number } {
    if (typeof line === "object") {
      const { lineNumber, columnNumber } = line;
      line = lineNumber;
      column = columnNumber;
    }

    const { sourceMap } = source;
    const { line: line0, column: column0 } = sourceMap.originalPosition(line, column);

    return {
      line: line0,
      column: column0,
    };
  }

  async setBreakpoints(request: DAP.SetBreakpointsRequest): Promise<DAP.SetBreakpointsResponse> {
    const { source: source0, breakpoints: requests } = request;
    const sourceId = sourceToId(source0);
    const source = await this.#getSource(sourceId);

    const oldBreakpoints = this.#getBreakpoints(sourceId);

    const breakpoints = await Promise.all(
      requests!.map(async ({ line, column, ...options }) => {
        const breakpoint = this.#getBreakpoint(sourceId, line, column);
        if (breakpoint) {
          return breakpoint;
        }

        const location = this.#generatedLocation(source, line, column);
        try {
          const { breakpointId, actualLocation } = await this.#send("Debugger.setBreakpoint", {
            location,
            options: breakpointOptions(options),
          });

          const originalLocation = this.#originalLocation(source, actualLocation);
          return this.#addBreakpoint({
            id: this.#breakpointId++,
            breakpointId,
            source,
            verified: true,
            ...originalLocation,
          });
        } catch (error) {
          const { message } = unknownToError(error);
          // If there was an error setting the breakpoint,
          // mark it as unverified and add a message.
          const breakpointId = this.#breakpointId++;
          return this.#addBreakpoint({
            id: breakpointId,
            breakpointId: `${breakpointId}`,
            line,
            column,
            source,
            verified: false,
            message,
          });
        }
      }),
    );

    await Promise.all(
      oldBreakpoints.map(async ({ breakpointId }) => {
        const isRemoved = !breakpoints.filter(({ breakpointId: id }) => breakpointId === id).length;
        if (isRemoved) {
          await this.#send("Debugger.removeBreakpoint", {
            breakpointId,
          });
          this.#removeBreakpoint(breakpointId);
        }
      }),
    );

    return {
      breakpoints,
    };
  }

  #getBreakpoints(sourceId: string | number): Breakpoint[] {
    const breakpoints: Breakpoint[] = [];

    for (const breakpoint of this.#breakpoints.values()) {
      const { source } = breakpoint;
      if (sourceId === sourceToId(source)) {
        breakpoints.push(breakpoint);
      }
    }

    return breakpoints;
  }

  #getBreakpoint(sourceId: string | number, line?: number, column?: number): Breakpoint | undefined {
    for (const breakpoint of this.#getBreakpoints(sourceId)) {
      if (isSameLocation(breakpoint, { line, column })) {
        return breakpoint;
      }
    }
    return undefined;
  }

  #addBreakpoint(breakpoint: Breakpoint): Breakpoint {
    this.#breakpoints.push(breakpoint);

    this.#emit("breakpoint", {
      reason: "changed",
      breakpoint,
    });

    return breakpoint;
  }

  #removeBreakpoint(breakpointId: string): void {
    const breakpoint = this.#breakpoints.find(({ breakpointId: id }) => id === breakpointId);
    if (!breakpoint) {
      return;
    }

    this.#breakpoints = this.#breakpoints.filter(({ breakpointId: id }) => id !== breakpointId);
    this.#emit("breakpoint", {
      reason: "removed",
      breakpoint,
    });
  }

  async setFunctionBreakpoints(
    request: DAP.SetFunctionBreakpointsRequest,
  ): Promise<DAP.SetFunctionBreakpointsResponse> {
    const { breakpoints: requests } = request;

    const oldBreakpoints = this.#getFunctionBreakpoints();

    const breakpoints = await Promise.all(
      requests.map(async ({ name, ...options }) => {
        const breakpoint = this.#getFunctionBreakpoint(name);
        if (breakpoint) {
          return breakpoint;
        }

        try {
          await this.#send("Debugger.addSymbolicBreakpoint", {
            symbol: name,
            caseSensitive: true,
            isRegex: false,
            options: breakpointOptions(options),
          });
        } catch (error) {
          const { message } = unknownToError(error);
          return this.#addFunctionBreakpoint({
            id: this.#breakpointId++,
            name,
            verified: false,
            message,
          });
        }

        return this.#addFunctionBreakpoint({
          id: this.#breakpointId++,
          name,
          verified: true,
        });
      }),
    );

    await Promise.all(
      oldBreakpoints.map(async ({ name }) => {
        const isRemoved = !breakpoints.filter(({ name: n }) => name === n).length;
        if (isRemoved) {
          await this.#send("Debugger.removeSymbolicBreakpoint", {
            symbol: name,
            caseSensitive: true,
            isRegex: false,
          });
          this.#removeFunctionBreakpoint(name);
        }
      }),
    );

    return {
      breakpoints,
    };
  }

  #getFunctionBreakpoints(): FunctionBreakpoint[] {
    return [...this.#functionBreakpoints.values()];
  }

  #getFunctionBreakpoint(name: string): FunctionBreakpoint | undefined {
    return this.#functionBreakpoints.get(name);
  }

  #addFunctionBreakpoint(breakpoint: FunctionBreakpoint): FunctionBreakpoint {
    const { name } = breakpoint;
    this.#functionBreakpoints.set(name, breakpoint);
    this.#emit("breakpoint", {
      reason: "changed",
      breakpoint,
    });
    return breakpoint;
  }

  #removeFunctionBreakpoint(name: string): void {
    const breakpoint = this.#functionBreakpoints.get(name);
    if (!breakpoint || !this.#functionBreakpoints.delete(name)) {
      return;
    }
    this.#emit("breakpoint", {
      reason: "removed",
      breakpoint,
    });
  }

  async setExceptionBreakpoints(
    request: DAP.SetExceptionBreakpointsRequest,
  ): Promise<DAP.SetExceptionBreakpointsResponse> {
    const { filters, filterOptions } = request;
    const filterIds = [...filters];
    if (filterOptions) {
      filterIds.push(...filterOptions.map(({ filterId }) => filterId));
    }

    await this.#send("Debugger.setPauseOnExceptions", {
      state: exceptionFiltersToPauseOnExceptionsState(filterIds),
    });

    return {};
  }

  async variables(request: DAP.VariablesRequest): Promise<DAP.VariablesResponse> {
    const { variablesReference, start, count } = request;
    const variables = await this.#listVariables(variablesReference, start, count);
    return {
      variables: variables.sort(variablesSortBy),
    };
  }

  async evaluate(request: DAP.EvaluateRequest): Promise<DAP.EvaluateResponse> {
    const { expression, frameId, context } = request;
    const callFrameId = this.#getCallFrameId(frameId);
    const { result, wasThrown } = await this.#evaluate(expression, callFrameId);
    const { className } = result;
    if (context === "hover" && wasThrown && (className === "SyntaxError" || className === "ReferenceError")) {
      return {
        result: "",
        variablesReference: 0,
      };
    }
    const { name, value, ...variable } = this.#getVariable(result);
    return {
      ...variable,
      result: value,
    };
  }

  async #evaluate(expression: string, callFrameId?: string): Promise<JSC.Runtime.EvaluateResponse> {
    const method = callFrameId ? "Debugger.evaluateOnCallFrame" : "Runtime.evaluate";
    return this.#send(method, {
      callFrameId,
      expression: sanitizeExpression(expression),
      generatePreview: true,
      emulateUserGesture: true,
      doNotPauseOnExceptionsAndMuteConsole: true,
      includeCommandLineAPI: true,
    });
  }

  async stackTrace(request: DAP.StackTraceRequest): Promise<DAP.StackTraceResponse> {
    const { length } = this.#stackFrames;
    const { startFrame = 0, levels } = request;
    const endFrame = levels ? startFrame + levels : length;

    return {
      totalFrames: length,
      stackFrames: this.#stackFrames.slice(startFrame, endFrame),
    };
  }

  async scopes(request: DAP.ScopesRequest): Promise<DAP.ScopesResponse> {
    const { frameId } = request;

    for (const stackFrame of this.#stackFrames) {
      const { id, scopes } = stackFrame;
      if (id !== frameId || !scopes) {
        continue;
      }
      return {
        scopes,
      };
    }

    return {
      scopes: [],
    };
  }

  ["Inspector.connected"](): void {
    this.#emit("output", {
      category: "debug console",
      output: "Debugger attached.\n",
    });

    this.#emit("initialized");
  }

  ["Inspector.disconnected"](error?: Error): void {
    this.#emit("output", {
      category: "debug console",
      output: "Debugger detached.\n",
    });

    if (error) {
      const { message } = error;
      this.#emit("output", {
        category: "stderr",
        output: `${message}\n`,
      });
    }

    this.#emit("terminated", {
      restart: this.#process?.exitCode === null,
    });
    this.#reset();
  }

  async ["Debugger.scriptParsed"](event: JSC.Debugger.ScriptParsedEvent): Promise<void> {
    // HACK: remove once Bun starts sending correct source map urls
    if (event.url && event.url.startsWith("/")) {
      event.sourceMapURL = generateSourceMapUrl(event.url);
    }
    const { url, scriptId, sourceMapURL } = event;

    // If no url is present, the script is from a `evaluate` request.
    if (!url) {
      return;
    }

    // Sources can be retrieved in two ways:
    // 1. If it has a `path`, the client retrieves the source from the file system.
    // 2. If it has a `sourceReference`, the client sends a `source` request.
    //    Moreover, the code is usually shown in a read-only editor.
    const isUserCode = url.startsWith("/");
    const sourceMap = SourceMap(sourceMapURL);
    const presentationHint = sourcePresentationHint(url);

    if (isUserCode) {
      this.#addSource({
        sourceId: url,
        scriptId,
        path: url,
        presentationHint,
        sourceMap,
      });
      return;
    }

    const sourceReference = this.#sourceId++;
    this.#addSource({
      sourceId: sourceReference,
      scriptId,
      sourceReference,
      presentationHint,
      sourceMap,
    });
  }

  ["Debugger.scriptFailedToParse"](event: JSC.Debugger.ScriptFailedToParseEvent): void {
    const { url, errorMessage, errorLine } = event;

    this.#emit("output", {
      category: "stderr",
      output: errorMessage,
      line: errorLine,
      source: {
        path: url || undefined,
      },
    });
  }

  ["Debugger.paused"](event: JSC.Debugger.PausedEvent): void {
    const { reason, callFrames, asyncStackTrace, data } = event;

    // If the debugger was paused on entry, don't emit an event.
    // When the client sends the `configurationDone` request, then
    // the debugger will be resumed.
    if (this.#stopped === "entry") {
      return;
    }

    this.#stackFrames.length = 0;
    this.#stopped ||= stoppedReason(reason);
    for (const callFrame of callFrames) {
      this.#addStackFrame(callFrame);
    }
    if (asyncStackTrace) {
      this.#addAsyncStackTrace(asyncStackTrace);
    }

    let hitBreakpointIds: number[] | undefined;
    // Depending on the reason, the `data` property is set to the reason
    // why the execution was paused. For example, if the reason is "breakpoint",
    // the `data` property is set to the breakpoint ID.
    if (data) {
      if (reason === "exception") {
        const remoteObject = data as JSC.Runtime.RemoteObject;
      }

      if (reason === "FunctionCall") {
        const { name } = data as { name: string };
        const breakpoint = this.#getFunctionBreakpoint(name);
        if (breakpoint) {
          const { id } = breakpoint;
          hitBreakpointIds = [id];
        }
      }

      if (reason === "Breakpoint") {
        const { breakpointId: hitBreakpointId } = data as { breakpointId: string };
        for (const { id, breakpointId } of this.#breakpoints.values()) {
          if (breakpointId === hitBreakpointId) {
            hitBreakpointIds = [id];
            break;
          }
        }
      }
    }

    this.#emit("stopped", {
      threadId,
      reason: this.#stopped,
      hitBreakpointIds,
    });
  }

  ["Debugger.resumed"](event: JSC.Debugger.ResumedEvent): void {
    this.#stackFrames.length = 0;
    this.#stopped = undefined;
    this.#emit("continued", {
      threadId,
    });
  }

  ["Console.messageAdded"](event: JSC.Console.MessageAddedEvent): void {
    const { message } = event;
    const { type, text, parameters, line, column, stackTrace } = message;

    let isError: boolean | undefined;
    let variablesReference: number | undefined;
    let output = text;
    for (const parameter of parameters ?? []) {
      isError = parameter.subtype === "error";
      variablesReference = this.#addVariable(parameter);
      output = remoteObjectToString(parameter);
      break;
    }

    let source: Source | undefined;
    if (stackTrace) {
      const { callFrames } = stackTrace;
      if (callFrames.length) {
        const [{ scriptId }] = callFrames.slice(0, -1);
        source = this.#getSourceIfPresent(scriptId);
      }
    }

    this.#emit("output", {
      category: isError ? "stderr" : "console",
      group: consoleMessageGroup(type),
      output,
      variablesReference,
      source,
      line,
      column,
    });
  }

  #addSource(source: Source): Source {
    const { scriptId, sourceId, path, sourceReference } = source;

    const oldSource = this.#getSourceIfPresent(sourceId);
    if (oldSource) {
      const { scriptId, path: oldPath } = oldSource;
      // For now, the script ID will always change.
      // Could that not be the case in the future?
      this.#sources.delete(scriptId);

      // If the path changed or the source has a source reference,
      // the old source should be marked as removed.
      if (path !== oldPath || sourceReference) {
        this.#emit("loadedSource", {
          reason: "removed",
          source: oldSource,
        });
      }
    }

    this.#sources.set(sourceId, source);
    this.#sources.set(scriptId, source);
    this.#emit("loadedSource", {
      reason: oldSource ? "changed" : "new",
      source,
    });

    if (!path) {
      return source;
    }

    const resolves = this.#pendingSources.get(sourceId);
    if (resolves) {
      this.#pendingSources.delete(sourceId);
      for (const resolve of resolves) {
        resolve(source);
      }
    }

    return source;
  }

  #getSourceIfPresent(sourceId: string | number): Source | undefined {
    return this.#sources.get(sourceId);
  }

  async #getSource(sourceId: string | number): Promise<Source> {
    const source = this.#getSourceIfPresent(sourceId);
    if (source) {
      return source;
    }
    if (typeof sourceId === "number" || !sourceId.startsWith("/")) {
      throw new Error(`Source not found: ${sourceId}`);
    }
    let resolves = this.#pendingSources.get(sourceId);
    if (!resolves) {
      this.#pendingSources.set(sourceId, (resolves = []));
    }
    return new Promise(resolve => {
      resolves!.push(resolve);
    });
  }

  #getCallFrameId(frameId?: number): string | undefined {
    for (const { id, callFrameId } of this.#stackFrames) {
      if (id === frameId) {
        return callFrameId;
      }
    }
    return undefined;
  }

  #addStackFrame(callFrame: JSC.Debugger.CallFrame): StackFrame {
    const { callFrameId, functionName, location, scopeChain } = callFrame;
    const { scriptId } = location;
    const source = this.#getSourceIfPresent(scriptId);

    let { lineNumber, columnNumber } = location;
    if (source) {
      const { line, column } = this.#originalLocation(source, location);
      lineNumber = line;
      columnNumber = column;
    }

    const scopes: Scope[] = [];
    const stackFrame: StackFrame = {
      callFrameId,
      scriptId,
      id: this.#stackFrames.length,
      name: functionName || "<anonymous>",
      line: lineNumber,
      column: columnNumber || 0,
      presentationHint: stackFramePresentationHint(source?.path),
      source,
      scopes,
    };
    this.#stackFrames.push(stackFrame);

    for (const scope of scopeChain) {
      const { name, type, location, object, empty } = scope;
      if (empty || !location) {
        continue;
      }
      const { scriptId } = location;
      const source = this.#getSourceIfPresent(scriptId);
      const variablesReference = this.#addVariable(object);
      const presentationHint = scopePresentationHint(type);
      const title = presentationHint ? titleize(presentationHint) : "Unknown";
      const displayName = name ? `${title}: ${name}` : title;

      let { lineNumber, columnNumber } = location;
      if (source) {
        const { line, column } = this.#originalLocation(source, location);
        lineNumber = line;
        columnNumber = column;
      }

      scopes.push({
        name: displayName,
        presentationHint,
        expensive: presentationHint === "globals",
        variablesReference,
        line: lineNumber,
        column: columnNumber,
        source,
      });
    }

    return stackFrame;
  }

  #addAsyncStackTrace(stackTrace: JSC.Console.StackTrace): void {
    const { callFrames, parentStackTrace } = stackTrace;

    for (const callFrame of callFrames) {
      this.#addAsyncStackFrame(callFrame);
    }

    if (parentStackTrace) {
      this.#addAsyncStackTrace(parentStackTrace);
    }
  }

  #addAsyncStackFrame(callFrame: JSC.Console.CallFrame): StackFrame {
    const { scriptId, functionName } = callFrame;
    const callFrameId = callFrameToId(callFrame);
    const source = this.#getSourceIfPresent(scriptId);

    let { lineNumber, columnNumber } = callFrame;
    if (source) {
      const { line, column } = this.#originalLocation(source, callFrame);
      lineNumber = line;
      columnNumber = column;
    }

    const stackFrame: StackFrame = {
      callFrameId,
      scriptId,
      id: this.#stackFrames.length,
      name: functionName || "<anonymous>",
      line: lineNumber,
      column: columnNumber,
      source,
      presentationHint: stackFramePresentationHint(source?.path),
      canRestart: false,
    };
    this.#stackFrames.push(stackFrame);

    return stackFrame;
  }

  #addVariable(remoteObject: JSC.Runtime.RemoteObject): number {
    const objectId = remoteObjectToObjectId(remoteObject);
    if (!objectId) {
      return 0;
    }
    const variableReference = this.#variableId++;
    this.#variables.set(variableReference, remoteObject);
    return variableReference;
  }

  #getVariable(
    remoteObject: JSC.Runtime.RemoteObject,
    propertyDescriptor?: JSC.Runtime.PropertyDescriptor,
  ): DAP.Variable {
    const { type, subtype, size } = remoteObject;
    const variablesReference = this.#addVariable(remoteObject);
    return {
      name: propertyDescriptorToName(propertyDescriptor),
      type: subtype || type,
      value: remoteObjectToString(remoteObject),
      variablesReference,
      indexedVariables: isIndexed(subtype) ? size : undefined,
      namedVariables: isNamedIndexed(subtype) ? size : undefined,
      presentationHint: remoteObjectToVariablePresentationHint(remoteObject, propertyDescriptor),
    };
  }

  #getVariables(propertyDescriptor: JSC.Runtime.PropertyDescriptor): DAP.Variable[] {
    const { value, get, set, symbol } = propertyDescriptor;
    const variables: DAP.Variable[] = [];
    if (value) {
      variables.push(this.#getVariable(value, propertyDescriptor));
    }
    if (get) {
      const { type } = get;
      if (type !== "undefined") {
        variables.push(this.#getVariable(get, propertyDescriptor));
      }
    }
    if (set) {
      const { type } = set;
      if (type !== "undefined") {
        variables.push(this.#getVariable(set, propertyDescriptor));
      }
    }
    if (symbol) {
      variables.push(this.#getVariable(symbol, propertyDescriptor));
    }
    return variables;
  }

  async #listVariables(variableReference: number, offset?: number, count?: number): Promise<DAP.Variable[]> {
    const remoteObject = this.#variables.get(variableReference);
    if (!remoteObject) {
      return [];
    }
    const { objectId, subtype, size } = remoteObject;
    if (!objectId) {
      return [];
    }
    const { properties } = await this.#send("Runtime.getDisplayableProperties", {
      objectId,
      generatePreview: true,
    });
    const variables: DAP.Variable[] = [];
    for (const property of properties) {
      variables.push(...this.#getVariables(property));
    }
    const hasEntries = !!size && subtype !== "array" && (isIndexed(subtype) || isNamedIndexed(subtype));
    if (hasEntries) {
      const { entries } = await this.#send("Runtime.getCollectionEntries", {
        objectId,
        fetchStart: offset,
        fetchCount: count,
      });
      let i = 0;
      for (const { key, value } of entries) {
        let name = String(i++);
        if (key) {
          const { value, description } = key;
          name = String(value ?? description);
        }
        variables.push(this.#getVariable(value, { name }));
      }
    }
    return variables;
  }
}

function stoppedReason(reason: JSC.Debugger.PausedEvent["reason"]): DAP.StoppedEvent["reason"] {
  switch (reason) {
    case "Breakpoint":
      return "breakpoint";
    case "FunctionCall":
      return "function breakpoint";
    case "PauseOnNextStatement":
    case "DebuggerStatement":
      return "pause";
    case "exception":
    case "assert":
      return "exception";
    default:
      return "breakpoint";
  }
}

function titleize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function sourcePresentationHint(url?: string): DAP.Source["presentationHint"] {
  if (!url || !url.startsWith("/")) {
    return "deemphasize";
  }
  if (url.includes("/node_modules/")) {
    return "normal";
  }
  return "emphasize";
}

function stackFramePresentationHint(path?: string): DAP.StackFrame["presentationHint"] {
  if (!path || path.includes("/node_modules/")) {
    return "subtle";
  }
  return "normal";
}

function scopePresentationHint(type: JSC.Debugger.Scope["type"]): DAP.Scope["presentationHint"] {
  switch (type) {
    case "closure":
    case "functionName":
    case "with":
    case "catch":
    case "nestedLexical":
      return "locals";
    case "global":
    case "globalLexicalEnvironment":
      return "globals";
    default:
      return undefined;
  }
}

function isIndexed(subtype: JSC.Runtime.RemoteObject["subtype"]): boolean {
  return subtype === "array" || subtype === "set" || subtype === "weakset";
}

function isNamedIndexed(subtype: JSC.Runtime.RemoteObject["subtype"]): boolean {
  return subtype === "map" || subtype === "weakmap";
}

function exceptionFiltersToPauseOnExceptionsState(
  filters?: string[],
): JSC.Debugger.SetPauseOnExceptionsRequest["state"] {
  if (filters?.includes("all")) {
    return "all";
  }
  if (filters?.includes("uncaught")) {
    return "uncaught";
  }
  return "none";
}

function breakpointOptions(breakpoint?: Partial<DAP.SourceBreakpoint>): JSC.Debugger.BreakpointOptions {
  const { condition } = breakpoint ?? {};
  // TODO: hitCondition, logMessage
  return {
    condition,
  };
}

function consoleMessageGroup(type: JSC.Console.ConsoleMessage["type"]): DAP.OutputEvent["group"] {
  switch (type) {
    case "startGroup":
      return "start";
    case "startGroupCollapsed":
      return "startCollapsed";
    case "endGroup":
      return "end";
  }
  return undefined;
}

function sourceToPath(source?: DAP.Source): string {
  const { path } = source ?? {};
  if (!path) {
    throw new Error("No source found.");
  }
  return path;
}

function sourceToId(source?: DAP.Source): string | number {
  const { path, sourceReference } = source ?? {};
  if (path) {
    return path;
  }
  if (sourceReference) {
    return sourceReference;
  }
  throw new Error("No source found.");
}

function callFrameToId(callFrame: JSC.Console.CallFrame): string {
  const { url, lineNumber, columnNumber } = callFrame;
  return `${url}:${lineNumber}:${columnNumber}`;
}

function remoteObjectToString(remoteObject: JSC.Runtime.RemoteObject): string {
  const { type, subtype, value, description, className, preview } = remoteObject;
  switch (type) {
    case "undefined":
      return "undefined";
    case "boolean":
    case "string":
      return JSON.stringify(value ?? description);
    case "number":
      return description ?? JSON.stringify(value);
    case "symbol":
    case "bigint":
      return description!;
    case "function":
      return description!.replace("function", "ƒ") || "ƒ";
  }
  switch (subtype) {
    case "null":
      return "null";
    case "regexp":
    case "date":
    case "error":
      return description!;
  }
  if (preview) {
    return objectPreviewToString(preview);
  }
  if (className) {
    return className;
  }
  return description || "Object";
}

function objectPreviewToString(objectPreview: JSC.Runtime.ObjectPreview): string {
  const { type, subtype, entries, properties, overflow, description, size } = objectPreview;
  if (type !== "object") {
    return remoteObjectToString(objectPreview);
  }
  let items: string[];
  if (entries) {
    items = entries.map(entryPreviewToString);
  } else if (properties) {
    if (isIndexed(subtype)) {
      items = properties.map(indexedPropertyPreviewToString);
    } else {
      items = properties.map(namedPropertyPreviewToString);
    }
  } else {
    items = ["…"];
  }
  if (overflow) {
    items.push("…");
  }
  let label: string;
  if (description === "Object") {
    label = "";
  } else if (size === undefined) {
    label = description!;
  } else {
    label = `${description}(${size})`;
  }
  if (!items.length) {
    return label || "{}";
  }
  if (label) {
    label += " ";
  }
  if (isIndexed(subtype)) {
    return `${label}[${items.join(", ")}]`;
  }
  return `${label}{${items.join(", ")}}`;
}

function propertyPreviewToString(propertyPreview: JSC.Runtime.PropertyPreview): string {
  const { type, value, ...preview } = propertyPreview;
  if (type === "accessor") {
    return "ƒ";
  }
  return remoteObjectToString({ ...preview, type, description: value });
}

function entryPreviewToString(entryPreview: JSC.Runtime.EntryPreview): string {
  const { key, value } = entryPreview;
  if (key) {
    return `${objectPreviewToString(key)} => ${objectPreviewToString(value)}`;
  }
  return objectPreviewToString(value);
}

function namedPropertyPreviewToString(propertyPreview: JSC.Runtime.PropertyPreview): string {
  const { name, valuePreview } = propertyPreview;
  if (valuePreview) {
    return `${name}: ${objectPreviewToString(valuePreview)}`;
  }
  return `${name}: ${propertyPreviewToString(propertyPreview)}`;
}

function indexedPropertyPreviewToString(propertyPreview: JSC.Runtime.PropertyPreview): string {
  const { valuePreview } = propertyPreview;
  if (valuePreview) {
    return objectPreviewToString(valuePreview);
  }
  return propertyPreviewToString(propertyPreview);
}

function sanitizeExpression(expression: string): string {
  expression = expression.trim();
  if (expression.startsWith("{")) {
    expression = `(${expression})`;
  }
  if (expression.startsWith("return ")) {
    expression = expression.slice(7);
  }
  if (expression.startsWith("await ")) {
    expression = expression.slice(6);
  }
  return expression;
}

function remoteObjectToVariablePresentationHint(
  remoteObject: JSC.Runtime.RemoteObject,
  propertyDescriptor?: JSC.Runtime.PropertyDescriptor,
): DAP.VariablePresentationHint {
  const { type, subtype } = remoteObject;
  const { name, configurable, writable, isPrivate, symbol, get, set, wasThrown } = propertyDescriptor ?? {};
  const hasGetter = get?.type === "function";
  const hasSetter = set?.type === "function";
  const hasSymbol = symbol?.type === "symbol";
  let kind: string | undefined;
  let visibility: string | undefined;
  let lazy: boolean | undefined;
  let attributes: string[] = [];
  if (type === "function") {
    kind = "method";
  }
  if (subtype === "class") {
    kind = "class";
  }
  if (isPrivate || !configurable || hasSymbol || name === "__proto__") {
    visibility = "internal";
  }
  if (type === "string") {
    attributes.push("rawString");
  }
  if (!writable || (hasGetter && !hasSetter)) {
    attributes.push("readOnly");
  }
  if (wasThrown || hasGetter) {
    lazy = true;
    attributes.push("hasSideEffects");
  }
  return {
    kind,
    visibility,
    lazy,
    attributes,
  };
}

function remoteObjectToObjectId(remoteObject: JSC.Runtime.RemoteObject): string | undefined {
  const { objectId, type } = remoteObject;
  if (!objectId || type === "symbol") {
    return undefined;
  }
  return objectId;
}

function propertyDescriptorToName(propertyDescriptor?: JSC.Runtime.PropertyDescriptor): string {
  if (!propertyDescriptor) {
    return "";
  }
  const { name } = propertyDescriptor;
  if (name === "__proto__") {
    return "[[Prototype]]";
  }
  return name;
}

function unknownToError(input: unknown): Error {
  if (input instanceof Error) {
    return input;
  }
  return new Error(String(input));
}

function isJavaScript(path: string): boolean {
  return /\.(c|m)?(j|t)sx?$/.test(path);
}

function parseUrl(hostname?: string, port?: number): URL {
  hostname ||= "localhost";
  port ||= 6499;
  let url: URL;
  try {
    if (hostname.includes("://")) {
      url = new URL(hostname);
    } else if (hostname.includes(":") && !hostname.startsWith("[")) {
      url = new URL(`ws://[${hostname}]:${port}/`);
    } else {
      url = new URL(`ws://${hostname}:${port}/`);
    }
  } catch {
    throw new Error(`Invalid URL or hostname/port: ${hostname}`);
  }
  // HACK: Bun sometimes has issues connecting through "127.0.0.1"
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.hostname = "[::1]";
  }
  return url;
}

function lookForUrl(messages?: string[]): URL | undefined {
  for (const message of messages ?? []) {
    const match = /(wss?:\/\/.*)/im.exec(message);
    if (!match) {
      continue;
    }
    const [_, href] = match;
    try {
      return parseUrl(href);
    } catch {
      throw new Error(`Invalid URL: ${href}`);
    }
  }
  return undefined;
}

function variablesSortBy(a: DAP.Variable, b: DAP.Variable): number {
  const visibility = (variable: DAP.Variable): number => {
    const { presentationHint } = variable;
    switch (presentationHint?.visibility) {
      case "protected":
        return 1;
      case "private":
        return 2;
      case "internal":
        return 3;
    }
    return 0;
  };
  const index = (variable: DAP.Variable): number => {
    const { name } = variable;
    switch (name) {
      case "[[Prototype]]":
      case "prototype":
      case "__proto__":
        return Number.MAX_VALUE;
    }
    const index = parseInt(name);
    if (isFinite(index)) {
      return index;
    }
    return 0;
  };
  const av = visibility(a);
  const bv = visibility(b);
  if (av > bv) return 1;
  if (av < bv) return -1;
  const ai = index(a);
  const bi = index(b);
  if (ai > bi) return 1;
  if (ai < bi) return -1;
  return 0;
}

// HACK: this will be removed once Bun starts sending source maps
// with the `Debugger.scriptParsed` event.
function generateSourceMapUrl(path: string): string | undefined {
  const { stdout } = spawnSync("bunx", ["esbuild", path, "--sourcemap=inline"], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  const match = /sourceMappingURL=(.*)/im.exec(stdout);
  if (!match) {
    return undefined;
  }
  const [_, sourceMapUrl] = match;
  return sourceMapUrl;
}

function isSameLocation(a: { line?: number; column?: number }, b: { line?: number; column?: number }): boolean {
  return (a.line === b.line || (!a.line && !b.line)) && (a.column === b.column || (!a.column && !b.column));
}
