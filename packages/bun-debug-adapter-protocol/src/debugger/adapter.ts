import type { DAP } from "../protocol";
import type { JSC } from "../../../bun-inspector-protocol/src/protocol";
import type { InspectorEventMap } from "../../../bun-inspector-protocol/src/inspector";
// @ts-ignore
import { WebSocketInspector, remoteObjectToString } from "../../../bun-inspector-protocol/index";
import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import capabilities from "./capabilities";
import { Location, SourceMap } from "./sourcemap";
import { compare, parse } from "semver";
import { EventEmitter } from "node:events";

type InitializeRequest = DAP.InitializeRequest & {
  supportsConfigurationDoneRequest?: boolean;
};

type LaunchRequest = DAP.LaunchRequest & {
  runtime?: string;
  program?: string;
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
  inheritEnv?: boolean;
  watch?: boolean | "hot";
  debug?: boolean;
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
  generatedLocation: JSC.Debugger.Location;
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

type Variable = DAP.Variable & {
  objectId?: string;
  type: JSC.Runtime.RemoteObject["type"] | JSC.Runtime.RemoteObject["subtype"];
};

type IDebugAdapter = {
  [E in keyof DAP.EventMap]?: (event: DAP.EventMap[E]) => void | Promise<void>;
} & {
  [R in keyof DAP.RequestMap]?: (
    request: DAP.RequestMap[R],
  ) => void | DAP.ResponseMap[R] | Promise<DAP.ResponseMap[R]> | Promise<void>;
};

export type DebugAdapterEventMap = InspectorEventMap & {
  [E in keyof DAP.EventMap as E extends string ? `Adapter.${E}` : never]: [DAP.EventMap[E]];
} & {
  "Adapter.request": [DAP.Request];
  "Adapter.response": [DAP.Response];
  "Adapter.event": [DAP.Event];
  "Adapter.error": [Error];
} & {
  "Process.requested": [unknown];
  "Process.spawned": [ChildProcess];
  "Process.exited": [number | Error | null, string | null];
  "Process.stdout": [string];
  "Process.stderr": [string];
};

// This adapter only support single-threaded debugging,
// which means that there is only one thread at a time.
const threadId = 1;
const isDebug = process.env.NODE_ENV === "development";

export class DebugAdapter extends EventEmitter<DebugAdapterEventMap> implements IDebugAdapter {
  #inspector: WebSocketInspector;
  #sourceId: number;
  #pendingSources: Map<string, ((source: Source) => void)[]>;
  #sources: Map<string | number, Source>;
  #stackFrames: StackFrame[];
  #stopped?: DAP.StoppedEvent["reason"];
  #breakpointId: number;
  #breakpoints: Breakpoint[];
  #functionBreakpoints: Map<string, FunctionBreakpoint>;
  #variables: (Variable | Variable[])[];
  #process?: ChildProcess;
  #initialized?: InitializeRequest;
  #launched?: LaunchRequest;
  #connected?: boolean;

  constructor(url?: string | URL) {
    super();
    this.#inspector = new WebSocketInspector(url);
    const emit = this.#inspector.emit.bind(this.#inspector);
    this.#inspector.emit = (event, ...args) => {
      let sent = false;
      sent ||= emit(event, ...args);
      sent ||= this.emit(event, ...(args as any));
      return sent;
    };
    this.#sourceId = 1;
    this.#pendingSources = new Map();
    this.#sources = new Map();
    this.#stackFrames = [];
    this.#stopped = undefined;
    this.#breakpointId = 1;
    this.#breakpoints = [];
    this.#functionBreakpoints = new Map();
    this.#variables = [{ name: "", value: "", type: undefined, variablesReference: 0 }];
  }

  get url(): string {
    return this.#inspector.url;
  }

  start(url?: string): Promise<boolean> {
    return this.#inspector.start(url);
  }

  /**
   * Sends a request to the JavaScript inspector.
   * @param method the method name
   * @param params the method parameters
   * @returns the response
   * @example
   * const { result, wasThrown } = await adapter.send("Runtime.evaluate", {
   *   expression: "1 + 1",
   * });
   * console.log(result.value); // 2
   */
  async send<M extends keyof JSC.ResponseMap>(method: M, params?: JSC.RequestMap[M]): Promise<JSC.ResponseMap[M]> {
    return this.#inspector.send(method, params);
  }

  /**
   * Emits an event. For the adapter to work, you must:
   * - emit `Adapter.request` when the client sends a request to the adapter.
   * - listen to `Adapter.response` to receive responses from the adapter.
   * - listen to `Adapter.event` to receive events from the adapter.
   * @param event the event name
   * @param args the event arguments
   * @returns if the event was sent to a listener
   */
  emit<E extends keyof DebugAdapterEventMap>(event: E, ...args: DebugAdapterEventMap[E] | []): boolean {
    if (isDebug && event !== "Adapter.event" && event !== "Inspector.event") {
      console.log(event, ...args);
    }

    let sent = super.emit(event, ...(args as any));

    if (!(event in this)) {
      return sent;
    }

    let result: unknown;
    try {
      // @ts-ignore
      result = this[event as keyof this](...(args as any));
    } catch (cause) {
      sent ||= this.emit("Adapter.error", unknownToError(cause));
      return sent;
    }

    if (result instanceof Promise) {
      result.catch(cause => {
        this.emit("Adapter.error", unknownToError(cause));
      });
    }

    return sent;
  }

  #emit<E extends keyof DAP.EventMap>(event: E, body?: DAP.EventMap[E]): void {
    this.emit("Adapter.event", {
      type: "event",
      seq: 0,
      event,
      body,
    });
  }

  async ["Adapter.request"](request: DAP.Request): Promise<void> {
    const { command, arguments: args } = request;

    if (!(command in this)) {
      return;
    }

    let result: unknown;
    try {
      // @ts-ignore
      result = await this[command as keyof this](args);
    } catch (cause) {
      const error = unknownToError(cause);
      this.emit("Adapter.error", error);

      const { message } = error;
      this.emit("Adapter.response", {
        type: "response",
        command,
        success: false,
        message,
        request_seq: request.seq,
        seq: 0,
      });
      return;
    }

    this.emit("Adapter.response", {
      type: "response",
      command,
      success: true,
      request_seq: request.seq,
      seq: 0,
      body: result,
    });
  }

  ["Adapter.event"](event: DAP.Event): void {
    const { event: name, body } = event;
    this.emit(`Adapter.${name}` as keyof DebugAdapterEventMap, body);
  }

  async #spawn(options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    strictEnv?: boolean;
    isDebugee?: boolean;
  }): Promise<boolean> {
    const { command, args = [], cwd, env = {}, strictEnv, isDebugee } = options;
    const request = {
      command,
      args,
      cwd,
      env: strictEnv ? env : { ...process.env, ...env },
    };
    this.emit("Process.requested", request);

    let subprocess: ChildProcess;
    try {
      subprocess = spawn(command, args, {
        ...request,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      this.emit("Process.exited", new Error("Failed to spawn process", { cause }), null);
      return false;
    }

    subprocess.on("spawn", () => {
      this.emit("Process.spawned", subprocess);

      if (isDebugee) {
        this.#emit("process", {
          name: `${command} ${args.join(" ")}`,
          systemProcessId: subprocess.pid,
          isLocalProcess: true,
          startMethod: "launch",
        });
      }
    });

    subprocess.on("exit", (code, signal) => {
      this.emit("Process.exited", code, signal);

      if (isDebugee) {
        this.#emit("exited", {
          exitCode: code ?? -1,
        });
      }
    });

    subprocess.stdout?.on("data", data => {
      this.emit("Process.stdout", data.toString());
    });

    subprocess.stderr?.on("data", data => {
      this.emit("Process.stderr", data.toString());
    });

    return new Promise(resolve => {
      subprocess.on("spawn", () => resolve(true));
      subprocess.on("exit", () => resolve(false));
      subprocess.on("error", () => resolve(false));
    });
  }

  initialize(request: InitializeRequest): DAP.InitializeResponse {
    const { clientID, supportsConfigurationDoneRequest } = (this.#initialized = request);

    this.send("Inspector.enable");
    this.send("Runtime.enable");
    this.send("Console.enable");
    this.send("Debugger.enable");
    this.send("Debugger.setAsyncStackTraceDepth", { depth: 200 });
    this.send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
    this.send("Debugger.setBlackboxBreakpointEvaluations", { blackboxBreakpointEvaluations: true });
    this.send("Debugger.setBreakpointsActive", { active: true });

    // If the client will not send a `configurationDone` request, then we need to
    // tell the debugger that everything is ready.
    if (!supportsConfigurationDoneRequest && clientID !== "vscode") {
      this.send("Inspector.initialized");
    }

    // Tell the client what capabilities this adapter supports.
    return capabilities;
  }

  configurationDone(): void {
    // If the client requested that `noDebug` mode be enabled,
    // then we need to disable all breakpoints and pause on statements.
    if (this.#launched?.noDebug) {
      this.send("Debugger.setBreakpointsActive", { active: false });
      this.send("Debugger.setPauseOnExceptions", { state: "none" });
      this.send("Debugger.setPauseOnDebuggerStatements", { enabled: false });
      this.send("Debugger.setPauseOnMicrotasks", { enabled: false });
      this.send("Debugger.setPauseForInternalScripts", { shouldPause: false });
      this.send("Debugger.setPauseOnAssertions", { enabled: false });
    }

    // Tell the debugger that everything is ready.
    this.send("Inspector.initialized");
  }

  async launch(request: DAP.LaunchRequest): Promise<void> {
    this.#launched = request;

    try {
      await this.#launch(request);
    } catch (error) {
      // Some clients, like VSCode, will show a system-level popup when a `launch` request fails.
      // Instead, we want to show the error as a sidebar notification.
      const { message } = unknownToError(error);
      this.#emit("output", {
        category: "stderr",
        output: `Failed to start debugger.\n${message}`,
      });
      this.terminate();
    }
  }

  async #launch(request: LaunchRequest): Promise<void> {
    /*
    if (this.#process?.exitCode === null) {
      throw new Error("Another program is already running. Did you terminate the last session?");
    }

    const { program, runtime = "bun", args = [], cwd, env = {}, inheritEnv = true, watch = false } = request;
    if (!program) {
      throw new Error("No program specified. Did you set the 'program' property in your launch.json?");
    }

    if (!isJavaScript(program)) {
      throw new Error("Program must be a JavaScript or TypeScript file.");
    }

    const finalArgs = [...args];
    const isTest = isTestJavaScript(program);
    if (isTest) {
      finalArgs.unshift("test");
    }

    if (watch) {
      finalArgs.push(watch === "hot" ? "--hot" : "--watch");
    }

    const finalEnv = inheritEnv
      ? {
          ...process.env,
          ...env,
        }
      : {
          ...env,
        };

    finalEnv["BUN_INSPECT"] = `1${this.#url}`;
    finalEnv["BUN_INSPECT_NOTIFY"] = `unix://${this.#inspector.unix}`;

    if (true) {
      finalEnv["FORCE_COLOR"] = "1";
    } else {
      // https://github.com/microsoft/vscode/issues/571
      finalEnv["NO_COLOR"] = "1";
    }

    let reason = undefined;

    if (reason instanceof Error) {
      const { message } = reason;
      throw new Error(`Program could not be started.\n${message}`);
    }

    if (reason !== undefined) {
      throw new Error(`Program exited with code ${reason} before the debugger could attached.`);
    }

    if (await this.#start()) {
      return;
    }

    if (subprocess.exitCode === null && !subprocess.kill() && !subprocess.kill("SIGKILL")) {
      this.#emit("output", {
        category: "debug console",
        output: `Failed to kill process ${subprocess.pid}\n`,
      });
    }

    const { stdout: version } = spawnSync(runtime, ["--version"], { stdio: "pipe", encoding: "utf-8" });

    const minVersion = "0.8.2";
    if (parse(version, true) && compare(minVersion, version, true)) {
      throw new Error(`This extension requires Bun v${minVersion} or later. Please upgrade by running: bun upgrade`);
    }

    throw new Error("Program started, but the debugger could not be attached.");*/
  }

  async #start(url?: string | URL): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      const ok = await this.#inspector.start(url);
      if (ok) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 100 * i));
    }

    return false;
  }

  async attach(request: DAP.AttachRequest): Promise<void> {
    try {
      await this.#attach(request);
    } catch (error) {
      // Some clients, like VSCode, will show a system-level popup when a `launch` request fails.
      // Instead, we want to show the error as a sidebar notification.
      const { message } = unknownToError(error);
      this.#emit("output", {
        category: "stderr",
        output: `Failed to start debugger.\n${message}`,
      });
      this.terminate();
    }
  }

  async #attach(request: AttachRequest): Promise<void> {
    const { url } = request;

    if (await this.#start(url)) {
      this.configurationDone();
      return;
    }

    throw new Error("Failed to attach to program.");
  }

  terminate(): void {
    this.#process?.kill();
    this.#emit("terminated");
  }

  disconnect(request: DAP.DisconnectRequest): void {
    const { terminateDebuggee } = request;

    if (terminateDebuggee) {
      this.terminate();
    }

    this.close();
  }

  async source(request: DAP.SourceRequest): Promise<DAP.SourceResponse> {
    const { source } = request;

    const { scriptId } = await this.#getSource(sourceToId(source));
    const { scriptSource } = await this.send("Debugger.getScriptSource", { scriptId });

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

  async pause(): Promise<void> {
    await this.send("Debugger.pause");
    this.#stopped = "pause";
  }

  async continue(): Promise<void> {
    await this.send("Debugger.resume");
    this.#stopped = undefined;
  }

  async next(): Promise<void> {
    await this.send("Debugger.stepNext");
    this.#stopped = "step";
  }

  async stepIn(): Promise<void> {
    await this.send("Debugger.stepInto");
    this.#stopped = "step";
  }

  async stepOut(): Promise<void> {
    await this.send("Debugger.stepOut");
    this.#stopped = "step";
  }

  async breakpointLocations(request: DAP.BreakpointLocationsRequest): Promise<DAP.BreakpointLocationsResponse> {
    const { line, endLine, column, endColumn, source: source0 } = request;
    const source = await this.#getSource(sourceToId(source0));

    const [start, end] = await Promise.all([
      this.#generatedLocation(source, line, column),
      this.#generatedLocation(source, endLine ?? line + 1, endColumn),
    ]);

    const { locations } = await this.send("Debugger.getBreakpointLocations", {
      start,
      end,
    });

    return {
      breakpoints: locations.map(location => this.#originalLocation(source, location)),
    };
  }

  #generatedLocation(source: Source, line?: number, column?: number): JSC.Debugger.Location {
    const { sourceMap, scriptId, path } = source;
    const { line: gline, column: gcolumn } = sourceMap.generatedLocation({
      line: this.#lineTo0BasedLine(line),
      column: this.#columnTo0BasedColumn(column),
      url: path,
    });

    return {
      scriptId,
      lineNumber: gline,
      columnNumber: gcolumn,
    };
  }

  #lineTo0BasedLine(line?: number): number {
    if (!numberIsValid(line)) {
      return 0;
    }
    if (!this.#initialized?.linesStartAt1) {
      return line;
    }
    return line - 1;
  }

  #columnTo0BasedColumn(column?: number): number {
    if (!numberIsValid(column)) {
      return 0;
    }
    if (!this.#initialized?.columnsStartAt1) {
      return column;
    }
    return column - 1;
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
    const { line: oline, column: ocolumn } = sourceMap.originalLocation({ line, column });

    return {
      line: this.#lineFrom0BasedLine(oline),
      column: this.#columnFrom0BasedColumn(ocolumn),
    };
  }

  #lineFrom0BasedLine(line?: number): number {
    if (!this.#initialized?.linesStartAt1) {
      return numberIsValid(line) ? line : 0;
    }
    return numberIsValid(line) ? line + 1 : 1;
  }

  #columnFrom0BasedColumn(column?: number): number {
    if (!this.#initialized?.columnsStartAt1) {
      return numberIsValid(column) ? column : 0;
    }
    return numberIsValid(column) ? column + 1 : 1;
  }

  async setBreakpoints(request: DAP.SetBreakpointsRequest): Promise<DAP.SetBreakpointsResponse> {
    const { source: source0, breakpoints: requests } = request;
    const sourceId = sourceToId(source0);
    const source = await this.#getSource(sourceId);

    const oldBreakpoints = this.#getBreakpoints(sourceId);
    console.log("OLD BREAKPOINTS", oldBreakpoints);

    const breakpoints = await Promise.all(
      requests!.map(async ({ line, column, ...options }) => {
        const location = this.#generatedLocation(source, line, column);
        console.log("NEW BREAKPOINT", location);

        for (const breakpoint of oldBreakpoints) {
          const { generatedLocation } = breakpoint;
          if (
            location.lineNumber === generatedLocation.lineNumber &&
            location.columnNumber === generatedLocation.columnNumber
          ) {
            console.log("SAME BREAKPOINT");
            return breakpoint;
          }
        }

        console.log("CREATE BREAKPOINT");
        try {
          const { breakpointId, actualLocation } = await this.send("Debugger.setBreakpoint", {
            location,
            options: breakpointOptions(options),
          });

          const originalLocation = this.#originalLocation(source, actualLocation);
          return this.#addBreakpoint({
            id: this.#breakpointId++,
            breakpointId,
            source,
            verified: true,
            generatedLocation: location,
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
            generatedLocation: location,
          });
        }
      }),
    );

    await Promise.all(
      oldBreakpoints.map(async ({ breakpointId }) => {
        const isRemoved = !breakpoints.filter(({ breakpointId: id }) => breakpointId === id).length;
        if (isRemoved) {
          await this.send("Debugger.removeBreakpoint", {
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

  #addBreakpoint(breakpoint: Breakpoint): Breakpoint {
    this.#breakpoints.push(breakpoint);

    // For now, remove the column from breakpoints because
    // it can be inaccurate and causes weird rendering issues in VSCode.
    breakpoint.column = this.#lineFrom0BasedLine(0);

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
          await this.send("Debugger.addSymbolicBreakpoint", {
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
          await this.send("Debugger.removeSymbolicBreakpoint", {
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

  async setExceptionBreakpoints(request: DAP.SetExceptionBreakpointsRequest): Promise<void> {
    const { filters, filterOptions } = request;

    const filterIds = [...filters];
    if (filterOptions) {
      filterIds.push(...filterOptions.map(({ filterId }) => filterId));
    }

    await this.send("Debugger.setPauseOnExceptions", {
      state: exceptionFiltersToPauseOnExceptionsState(filterIds),
    });
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

    const { name, value, ...variable } = this.#addVariable(result);
    return {
      ...variable,
      result: value,
    };
  }

  async #evaluate(expression: string, callFrameId?: string): Promise<JSC.Runtime.EvaluateResponse> {
    const method = callFrameId ? "Debugger.evaluateOnCallFrame" : "Runtime.evaluate";

    return this.send(method, {
      callFrameId,
      expression: sanitizeExpression(expression),
      generatePreview: true,
      emulateUserGesture: true,
      doNotPauseOnExceptionsAndMuteConsole: true,
      includeCommandLineAPI: true,
    });
  }

  restart(): void {
    this.initialize(this.#initialized!);
    this.configurationDone();

    this.#emit("output", {
      category: "debug console",
      output: "Debugger reloaded.\n",
    });
  }

  ["Inspector.connected"](): void {
    this.#emit("output", {
      category: "debug console",
      output: "Debugger attached.\n",
    });

    this.#emit("initialized");
  }

  async ["Inspector.disconnected"](error?: Error): Promise<void> {
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

    this.#emit("terminated");
    this.#reset();
  }

  async ["Debugger.scriptParsed"](event: JSC.Debugger.ScriptParsedEvent): Promise<void> {
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
    const name = sourceName(url);
    const presentationHint = sourcePresentationHint(url);

    if (isUserCode) {
      this.#addSource({
        sourceId: url,
        scriptId,
        name,
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
      name,
      sourceReference,
      presentationHint,
      sourceMap,
    });
  }

  ["Debugger.scriptFailedToParse"](event: JSC.Debugger.ScriptFailedToParseEvent): void {
    const { url, errorMessage, errorLine } = event;

    // If no url is present, the script is from a `evaluate` request.
    if (!url) {
      return;
    }

    this.#emit("output", {
      category: "stderr",
      output: errorMessage,
      line: this.#lineFrom0BasedLine(errorLine),
      source: {
        path: url || undefined,
      },
    });
  }

  ["Debugger.paused"](event: JSC.Debugger.PausedEvent): void {
    const { reason, callFrames, asyncStackTrace, data } = event;

    if (reason === "PauseOnNextStatement") {
      for (const { functionName } of callFrames) {
        if (functionName === "module code") {
          this.send("Debugger.resume");
          return;
        }
      }
    }

    this.#stackFrames.length = 0;
    this.#stopped ||= stoppedReason(reason);
    for (const callFrame of callFrames) {
      this.#addStackFrame(callFrame);
    }
    if (asyncStackTrace) {
      this.#addAsyncStackTrace(asyncStackTrace);
    }

    // Depending on the reason, the `data` property is set to the reason
    // why the execution was paused. For example, if the reason is "breakpoint",
    // the `data` property is set to the breakpoint ID.
    let hitBreakpointIds: number[] | undefined;

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
    const { type, level, text, parameters, line, column, stackTrace } = message;

    let output: string;
    let variablesReference: number | undefined;

    if (parameters?.length) {
      output = "";

      const variables = parameters.map((parameter, i) => {
        const variable = this.#addVariable(parameter, { name: `${i}` });
        output += remoteObjectToString(parameter, true) + " ";
        return variable;
      });

      if (variables.length === 1) {
        const [{ variablesReference: reference }] = variables;
        variablesReference = reference;
      } else {
        variablesReference = this.#setVariable(variables);
      }
    } else {
      output = text;
    }

    if (!output.endsWith("\n")) {
      output += "\n";
    }

    const color = consoleLevelToAnsiColor(level);
    if (color) {
      output = `${color}${output}`;
    }

    if (variablesReference) {
      variablesReference = this.#setVariable([
        {
          name: "",
          value: "",
          type: undefined,
          variablesReference,
        },
      ]);
    }

    let source: Source | undefined;
    if (stackTrace) {
      const { callFrames } = stackTrace;
      if (callFrames.length) {
        const { scriptId } = callFrames.at(-1)!;
        source = this.#getSourceIfPresent(scriptId);
      }
    }

    let location: Location | {} = {};
    if (source) {
      location = this.#originalLocation(source, line, column);
    }

    this.#emit("output", {
      category: "debug console",
      group: consoleMessageGroup(type),
      output,
      variablesReference,
      source,
      ...location,
    });
  }

  #addSource(source: Source): Source {
    const { sourceId, scriptId, path, sourceReference } = source;

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
      // If the reason is "changed", the source will be retrieved using
      // the `source` command, which is why it cannot be set when `path` is present.
      reason: oldSource && !path ? "changed" : "new",
      source,
    });

    if (!path) {
      return source;
    }

    // If there are any pending requests for this source by its path,
    // resolve them now that the source has been loaded.
    const resolves = this.#pendingSources.get(path);
    if (resolves) {
      this.#pendingSources.delete(path);
      for (const resolve of resolves) {
        resolve(source);
      }
    }

    return source;
  }

  loadedSources(): DAP.LoadedSourcesResponse {
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

  #getSourceIfPresent(sourceId: string | number): Source | undefined {
    return this.#sources.get(sourceId);
  }

  async #getSource(sourceId: string | number): Promise<Source> {
    const source = this.#getSourceIfPresent(sourceId);

    if (source) {
      return source;
    }

    // If the source does not have a path or is a builtin module,
    // it cannot be retrieved from the file system.
    if (typeof sourceId === "number" || !sourceId.startsWith("/")) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    // If the source is not present, it may not have been loaded yet.
    // In that case, wait for it to be loaded.
    let resolves = this.#pendingSources.get(sourceId);
    if (!resolves) {
      this.#pendingSources.set(sourceId, (resolves = []));
    }

    return new Promise(resolve => {
      resolves!.push(resolve);
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

    let originalLocation: Location;
    if (source) {
      originalLocation = this.#originalLocation(source, location);
    } else {
      const { lineNumber, columnNumber } = location;
      originalLocation = {
        line: this.#lineFrom0BasedLine(lineNumber),
        column: this.#columnFrom0BasedColumn(columnNumber),
      };
    }

    const { line, column } = originalLocation;
    const scopes: Scope[] = [];
    const stackFrame: StackFrame = {
      callFrameId,
      scriptId,
      id: this.#stackFrames.length,
      name: functionName || "<anonymous>",
      line,
      column,
      presentationHint: stackFramePresentationHint(source?.path),
      source,
      scopes,
    };
    this.#stackFrames.push(stackFrame);

    for (const scope of scopeChain) {
      const { name, type, location, object, empty } = scope;
      if (empty) {
        continue;
      }

      const { variablesReference } = this.#addVariable(object);
      const presentationHint = scopePresentationHint(type);
      const title = presentationHint ? titleize(presentationHint) : "Unknown";
      const displayName = name ? `${title}: ${name}` : title;

      let originalLocation: Location | undefined;
      if (location) {
        const { scriptId } = location;
        const source = this.#getSourceIfPresent(scriptId);

        if (source) {
          originalLocation = this.#originalLocation(source, location);
        } else {
          const { lineNumber, columnNumber } = location;
          originalLocation = {
            line: this.#lineFrom0BasedLine(lineNumber),
            column: this.#columnFrom0BasedColumn(columnNumber),
          };
        }
      }

      const { line, column } = originalLocation ?? {};
      scopes.push({
        name: displayName,
        presentationHint,
        expensive: presentationHint === "globals",
        variablesReference,
        line,
        column,
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

    let originalLocation: Location;
    if (source) {
      originalLocation = this.#originalLocation(source, callFrame);
    } else {
      const { lineNumber, columnNumber } = callFrame;
      originalLocation = {
        line: this.#lineFrom0BasedLine(lineNumber),
        column: this.#columnFrom0BasedColumn(columnNumber),
      };
    }

    const { line, column } = originalLocation;
    const stackFrame: StackFrame = {
      callFrameId,
      scriptId,
      id: this.#stackFrames.length,
      name: functionName || "<anonymous>",
      line,
      column,
      source,
      presentationHint: stackFramePresentationHint(source?.path),
      canRestart: false,
    };
    this.#stackFrames.push(stackFrame);

    return stackFrame;
  }

  async variables(request: DAP.VariablesRequest): Promise<DAP.VariablesResponse> {
    const { variablesReference, start, count } = request;
    const variable = this.#variables[variablesReference];

    let variables: Variable[];
    if (!variable) {
      variables = [];
    } else if (Array.isArray(variable)) {
      variables = variable;
    } else {
      variables = await this.#getVariables(variable, start, count);
    }

    return {
      variables: variables.sort(variablesSortBy),
    };
  }

  #setVariable(variable: Variable | Variable[]): number {
    const variablesReference = this.#variables.length;

    this.#variables.push(variable);

    return variablesReference;
  }

  #addVariable(remoteObject: JSC.Runtime.RemoteObject, propertyDescriptor?: JSC.Runtime.PropertyDescriptor): Variable {
    const { objectId, type, subtype, size } = remoteObject;
    const variablesReference = objectId ? this.#variables.length : 0;

    const variable: Variable = {
      objectId,
      name: propertyDescriptorToName(propertyDescriptor),
      type: subtype || type,
      value: remoteObjectToString(remoteObject),
      variablesReference,
      indexedVariables: isIndexed(subtype) ? size : undefined,
      namedVariables: isNamedIndexed(subtype) ? size : undefined,
      presentationHint: remoteObjectToVariablePresentationHint(remoteObject, propertyDescriptor),
    };
    this.#setVariable(variable);

    return variable;
  }

  async #getVariables(variable: Variable, offset?: number, count?: number): Promise<Variable[]> {
    const { objectId, type, indexedVariables, namedVariables } = variable;

    if (!objectId || type === "symbol") {
      return [];
    }

    const { properties, internalProperties } = await this.send("Runtime.getDisplayableProperties", {
      objectId,
      generatePreview: true,
    });

    const variables: Variable[] = [];
    for (const property of properties) {
      variables.push(...this.#getVariable(property));
    }

    if (internalProperties) {
      for (const property of internalProperties) {
        variables.push(...this.#getVariable({ ...property, configurable: false }));
      }
    }

    const hasEntries = type !== "array" && (indexedVariables || namedVariables);
    if (hasEntries) {
      const { entries } = await this.send("Runtime.getCollectionEntries", {
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
        variables.push(this.#addVariable(value, { name }));
      }
    }

    return variables;
  }

  #getVariable(
    propertyDescriptor: JSC.Runtime.PropertyDescriptor | JSC.Runtime.InternalPropertyDescriptor,
  ): Variable[] {
    const { value, get, set, symbol } = propertyDescriptor as JSC.Runtime.PropertyDescriptor;
    const variables: Variable[] = [];

    if (value) {
      variables.push(this.#addVariable(value, propertyDescriptor));
    }

    if (get) {
      const { type } = get;
      if (type !== "undefined") {
        variables.push(this.#addVariable(get, propertyDescriptor));
      }
    }

    if (set) {
      const { type } = set;
      if (type !== "undefined") {
        variables.push(this.#addVariable(set, propertyDescriptor));
      }
    }

    if (symbol) {
      variables.push(this.#addVariable(symbol, propertyDescriptor));
    }

    return variables;
  }

  close(): void {
    this.#process?.kill();
    this.#inspector.close();
    this.#reset();
  }

  #reset(): void {
    this.#pendingSources.clear();
    this.#sources.clear();
    this.#stackFrames.length = 0;
    this.#stopped = undefined;
    this.#breakpointId = 1;
    this.#breakpoints.length = 0;
    this.#functionBreakpoints.clear();
    this.#variables.length = 1;
    this.#launched = undefined;
    this.#initialized = undefined;
    this.#connected = undefined;
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

function sourceName(url?: string): string {
  if (!url) {
    return "unknown.js";
  }
  if (isJavaScript(url)) {
    return url.split("/").pop() || url;
  }
  return `${url}.js`;
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
  if (isPrivate || configurable === false || hasSymbol || name === "__proto__") {
    visibility = "internal";
  }
  if (type === "string") {
    attributes.push("rawString");
  }
  if (writable === false || (hasGetter && !hasSetter)) {
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

function isTestJavaScript(path: string): boolean {
  return /\.(test|spec)\.(c|m)?(j|t)sx?$/.test(path);
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

function isSameLocation(a: { line?: number; column?: number }, b: { line?: number; column?: number }): boolean {
  return (a.line === b.line || (!a.line && !b.line)) && (a.column === b.column || (!a.column && !b.column));
}

function consoleLevelToAnsiColor(level: JSC.Console.ConsoleMessage["level"]): string | undefined {
  switch (level) {
    case "warning":
      return "\u001b[33m";
    case "error":
      return "\u001b[31m";
  }
  return undefined;
}

function numberIsValid(number?: number): number is number {
  return typeof number === "number" && isFinite(number) && number >= 0;
}
