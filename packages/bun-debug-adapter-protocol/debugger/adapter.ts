import type { DAP } from "..";
import type { JSC, InspectorListener } from "../../bun-inspector-protocol";
import { WebSocketInspector } from "../../bun-inspector-protocol";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import capabilities from "./capabilities";

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
  path: string;
  scriptId: string;
};

type Thread = DAP.Thread & {
  scriptId: string;
};

type Breakpoint = DAP.Breakpoint & {
  id: number;
  breakpointId: string;
  source: Source;
};

type StackFrame = DAP.StackFrame & {
  scriptId: string;
  callFrameId: string;
  source?: Source;
  scopes?: DAP.Scope[];
};

type Scope = DAP.Scope & {
  source?: Source;
};

export type DebugAdapterOptions = {
  sendToAdapter(message: DAP.Request | DAP.Response | DAP.Event): Promise<void>;
};

type IDebugAdapter = {
  [E in keyof DAP.EventMap]?: (event: DAP.EventMap[E]) => void;
} & {
  [R in keyof DAP.RequestMap]?: (request: DAP.RequestMap[R]) => DAP.ResponseMap[R] | Promise<DAP.ResponseMap[R]>;
};

export class DebugAdapter implements IDebugAdapter, InspectorListener {
  #sendToAdapter: DebugAdapterOptions["sendToAdapter"];
  #url?: URL;
  #inspector: WebSocketInspector;
  #mode?: "launch" | "attach";
  #thread?: Thread;
  #pendingSources: Map<string, ((source: Source) => void)[]>;
  #sources: Map<string, Source>;
  #stackFrames: StackFrame[];
  #stopped?: DAP.StoppedEvent["reason"];
  #breakpointId: number;
  #breakpoints: Map<string, Map<string, Breakpoint>>;
  #variableId: number;
  #variables: Map<number, JSC.Runtime.RemoteObject>;
  #process?: ChildProcess;

  constructor({ sendToAdapter }: DebugAdapterOptions) {
    this.#inspector = new WebSocketInspector({ listener: this });
    this.#sendToAdapter = sendToAdapter;
    this.#pendingSources = new Map();
    this.#sources = new Map();
    this.#stackFrames = [];
    this.#stopped = undefined;
    this.#breakpointId = 1;
    this.#breakpoints = new Map();
    this.#variableId = 1;
    this.#variables = new Map();
  }

  #reset(): void {
    this.#mode = undefined;
    this.#thread = undefined;
    this.#pendingSources.clear();
    this.#sources.clear();
    this.#stackFrames.length = 0;
    this.#stopped = undefined;
    this.#breakpointId = 1;
    this.#breakpoints.clear();
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
    this.#send("Inspector.enable");
    this.#send("Runtime.enable");
    this.#send("Console.enable");
    this.#send("Debugger.enable");
    this.#send("Debugger.setAsyncStackTraceDepth", { depth: 200 });
    this.#send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
    this.#send("Debugger.setBlackboxBreakpointEvaluations", { blackboxBreakpointEvaluations: true });
    this.#send("Debugger.setBreakpointsActive", { active: true });

    return capabilities;
  }

  async configurationDone(request: DAP.ConfigurationDoneRequest): Promise<DAP.ConfigurationDoneResponse> {
    // @ts-ignore: FIXME does not work with attach only mode
    //const { scriptId } = await this.#getSource(this.#request.program ?? "");
    this.#setThread("2");

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

        this.#url = url;
        this.#mode = "launch";
        this.#inspector.start(this.#url);
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

    this.#url = parseUrl(url);
    this.#mode = "attach";
    this.#inspector.start(this.#url);

    return {};
  }

  async terminate(request: DAP.TerminateRequest): Promise<DAP.TerminateResponse> {
    this.#process?.kill();

    return {};
  }

  async disconnect(request: DAP.DisconnectRequest): Promise<DAP.DisconnectResponse> {
    const { terminateDebuggee } = request;

    if (terminateDebuggee) {
      await this.terminate(request);
    }

    this.close();
    return {};
  }

  async loadedSources(request: DAP.LoadedSourcesRequest): Promise<DAP.LoadedSourcesResponse> {
    const sources = this.#getSources();
    return {
      sources,
    };
  }

  async source(request: DAP.SourceRequest): Promise<DAP.SourceResponse> {
    const { source } = request;
    const path = sourceToPath(source);
    const { scriptId } = await this.#getSource(path);
    const { scriptSource } = await this.#send("Debugger.getScriptSource", { scriptId });
    return {
      content: scriptSource,
    };
  }

  async threads(request: DAP.ThreadsRequest): Promise<DAP.ThreadsResponse> {
    const threads = this.#thread ? [this.#thread] : [];
    return {
      threads,
    };
  }

  async pause(request: DAP.PauseRequest): Promise<DAP.PauseResponse> {
    await this.#send("Debugger.pause", {
      errorsToIgnore: ["Must be paused or waiting to pause"],
    });
    this.#stopped = "pause";
    return {};
  }

  async continue(request: DAP.ContinueRequest): Promise<DAP.ContinueResponse> {
    await this.#send("Debugger.resume", {
      errorsToIgnore: ["Must be paused or waiting to pause"],
    });
    this.#stopped = undefined;
    return {};
  }

  async next(request: DAP.NextRequest): Promise<DAP.NextResponse> {
    await this.#send("Debugger.stepNext", {
      errorsToIgnore: ["Must be paused or waiting to pause"],
    });
    this.#stopped = "step";
    return {};
  }

  async stepIn(request: DAP.StepInRequest): Promise<DAP.StepInResponse> {
    await this.#send("Debugger.stepInto", {
      errorsToIgnore: ["Must be paused or waiting to pause"],
    });
    this.#stopped = "step";
    return {};
  }

  async stepOut(request: DAP.StepOutRequest): Promise<DAP.StepOutResponse> {
    await this.#send("Debugger.stepOut", {
      errorsToIgnore: ["Must be paused or waiting to pause"],
    });
    this.#stopped = "step";
    return {};
  }

  async breakpointLocations(request: DAP.BreakpointLocationsRequest): Promise<DAP.BreakpointLocationsResponse> {
    const { line, endLine, column, endColumn, source } = request;
    const { scriptId } = await this.#getSource(sourceToPath(source));
    const { locations } = await this.#send("Debugger.getBreakpointLocations", {
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
    });
    const breakpoints = locations.map(({ lineNumber, columnNumber }) => ({
      line: lineNumber,
      column: columnNumber,
    }));
    return {
      breakpoints,
    };
  }

  async setBreakpoints(request: DAP.SetBreakpointsRequest): Promise<DAP.SetBreakpointsResponse> {
    const { source, breakpoints: requests, sourceModified } = request;
    const existingBreakpoints = this.#getBreakpoints(source);
    if (sourceModified || !requests?.length) {
      await Promise.all([...existingBreakpoints].map(([breakpointId]) => this.#clearBreakpoint(source, breakpointId)));
    }
    if (!requests?.length) {
      return {
        breakpoints: [],
      };
    }
    const breakpoints = await Promise.all(requests.map(request => this.#setBreakpoint(source, request)));
    await Promise.all(
      [...existingBreakpoints]
        .filter(([_, { id: breakpointId }]) => !breakpoints.some(({ id }) => id === breakpointId))
        .map(([breakpointId]) => this.#clearBreakpoint(source, breakpointId)),
    );
    return {
      breakpoints,
    };
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
    const { href } = this.#url!;
    this.#emit("output", {
      category: "debug console",
      output: `Attached to ${href}\n`,
    });

    this.#emit("initialized");
  }

  ["Inspector.disconnected"](error?: Error): void {
    const { href } = this.#url!;
    this.#emit("output", {
      category: "debug console",
      output: `Disconnected from ${href}\n`,
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
    const { url, scriptId } = event;
    if (!url) {
      return;
    }
    await this.#addSource({
      scriptId,
      path: url,
      presentationHint: sourcePresentationHint(url),
    });
  }

  ["Debugger.scriptFailedToParse"](event: JSC.Debugger.ScriptFailedToParseEvent): void {
    const { url, errorMessage, errorLine } = event;
    this.#emit("output", {
      category: "console",
      output: errorMessage,
      line: errorLine,
      source: {
        path: url,
      },
    });
  }

  ["Debugger.paused"](event: JSC.Debugger.PausedEvent): void {
    const { reason, callFrames, asyncStackTrace, data } = event;
    this.#stackFrames.length = 0;
    this.#stopped ||= stoppedReason(reason);
    for (const callFrame of callFrames) {
      this.#addStackFrame(callFrame);
    }
    if (asyncStackTrace) {
      this.#addAsyncStackTrace(asyncStackTrace);
    }
    let hitBreakpointIds: number[] | undefined;
    if (data) {
      if (reason === "exception") {
        const remoteObject = data as JSC.Runtime.RemoteObject;
        // TODO
      }
      const { breakpointId: hitId } = data;
      if (typeof hitId === "string") {
        loop: for (const breakpoints of this.#breakpoints.values()) {
          for (const [breakpointId, { id }] of breakpoints) {
            if (hitId === breakpointId && id) {
              hitBreakpointIds = [id];
              this.#stopped = "breakpoint";
              break loop;
            }
          }
        }
      }
    }
    this.#emit("stopped", {
      threadId: this.#thread?.id,
      reason: this.#stopped,
      hitBreakpointIds,
    });
  }

  ["Debugger.resumed"](event: JSC.Debugger.ResumedEvent): void {
    this.#stackFrames.length = 0;
    this.#stopped = undefined;
    this.#emit("continued");
  }

  ["Console.messageAdded"](event: JSC.Console.MessageAddedEvent): void {
    const { message } = event;
    const { type, text, parameters, line, column, stackTrace } = message;
    let variablesReference: number | undefined;
    let output = text;
    for (const parameter of parameters ?? []) {
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
      category: "console",
      group: consoleMessageGroup(type),
      output,
      variablesReference,
      source,
      line,
      column,
    });
  }

  #setThread(scriptId: string): void {
    if (!this.#thread) {
      this.#thread = {
        id: 1,
        name: "Main Thread",
        scriptId,
      };
      this.#emit("thread", {
        reason: "started",
        threadId: 1,
      });
    }
    this.#thread.scriptId = scriptId;
  }

  #getSources(): Source[] {
    const uniqueSources = new Map([...this.#sources.values()].map(source => [source.path, source]));
    return [...uniqueSources.values()];
  }

  #addSource(source: Source): void {
    const { path, scriptId } = source;
    const reload = this.#sources.has(path);
    if (reload) {
      const { scriptId: previousId } = this.#sources.get(path)!;
      this.#sources.delete(previousId);
      if (this.#thread?.scriptId === previousId) {
        this.#setThread(scriptId);
      }
    }
    this.#sources.set(path, source);
    this.#sources.set(scriptId, source);
    this.#emit("loadedSource", {
      reason: reload ? "changed" : "new",
      source,
    });
    const resolves = this.#pendingSources.get(path);
    if (resolves) {
      this.#pendingSources.delete(path);
      for (const resolve of resolves) {
        resolve(source);
      }
    }
  }

  #getSourceIfPresent(path: string): Source | undefined {
    return this.#sources.get(path);
  }

  async #getSource(path: string): Promise<Source> {
    const source = this.#getSourceIfPresent(path);
    if (source) {
      return source;
    }
    if (!path.startsWith("/")) {
      throw new Error(`Source not found: ${path}`);
    }
    let resolves = this.#pendingSources.get(path);
    if (!resolves) {
      this.#pendingSources.set(path, (resolves = []));
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
    const { scriptId, lineNumber, columnNumber } = location;
    const source = this.#getSourceIfPresent(scriptId);
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
      scopes.push({
        name: displayName,
        presentationHint,
        expensive: presentationHint === "globals",
        variablesReference,
        line: location?.lineNumber,
        column: location?.columnNumber,
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
    const { scriptId, functionName, lineNumber, columnNumber } = callFrame;
    const callFrameId = callFrameToId(callFrame);
    const source = this.#getSourceIfPresent(scriptId);
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

  #getBreakpoints(source: DAP.Source): Map<string, Breakpoint> {
    const path = sourceToPath(source);
    let breakpoints = this.#breakpoints.get(path);
    if (!breakpoints) {
      this.#breakpoints.set(path, (breakpoints = new Map()));
    }
    return breakpoints;
  }

  async #clearBreakpoint(source: DAP.Source, breakpointId: string): Promise<void> {
    const breakpoints = this.#getBreakpoints(source);
    const breakpoint = breakpoints.get(breakpointId);
    if (!breakpoint) {
      return;
    }
    await this.#send("Debugger.removeBreakpoint", {
      breakpointId,
    });
    this.#emit("breakpoint", {
      reason: "removed",
      breakpoint,
    });
    breakpoints.delete(breakpointId);
  }

  async #setBreakpoint(source: DAP.Source, breakpoint: DAP.SourceBreakpoint): Promise<Breakpoint> {
    const path = sourceToPath(source);
    const { line, column, ...options } = breakpoint;
    const { breakpointId, locations } = await this.#send("Debugger.setBreakpointByUrl", {
      url: path,
      lineNumber: line,
      columnNumber: column,
      options: breakpointOptions(options),
    });
    if (!locations.length) {
      throw new Error("Breakpoint has no locations");
    }
    if (locations.length > 1) {
      console.warn("Breakpoint has multiple locations:", breakpoint);
    }
    const [location] = locations;
    return this.#addBreakpoint(breakpointId, location);
  }

  async #addBreakpoint(breakpointId: string, location: JSC.Debugger.Location): Promise<Breakpoint> {
    const { scriptId, lineNumber, columnNumber } = location;
    const source = await this.#getSource(scriptId);
    const breakpoint: Breakpoint = {
      id: this.#breakpointId++,
      breakpointId,
      verified: true,
      line: lineNumber,
      column: columnNumber,
      source,
    };
    this.#getBreakpoints(source).set(breakpointId, breakpoint);
    this.#emit("breakpoint", {
      reason: "changed",
      breakpoint,
    });
    return breakpoint;
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

function sourcePresentationHint(path?: string): DAP.Source["presentationHint"] {
  if (!path) {
    return "deemphasize";
  }
  if (path.includes("/node_modules/")) {
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

function exceptionFilterOptionsToBreakpointOptions(
  options?: DAP.ExceptionFilterOptions[],
): JSC.Debugger.BreakpointOptions {
  return {};
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
