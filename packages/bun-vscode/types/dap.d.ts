// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// GENERATED - DO NOT EDIT
// https://github.com/microsoft/vscode-js-debug/blob/53cfeec1e92ad4d3323b308aaad650f6d1c1b6e6/src/dap/api.d.ts
// https://github.com/microsoft/vscode-js-debug/blob/53cfeec1e92ad4d3323b308aaad650f6d1c1b6e6/src/dap/error.d.ts

export namespace DAP {
  export type Message = {
    /**
     * Unique identifier for the message.
     */
    id: number;
  
    /**
     * A format string for the message. Embedded variables have the form '{name}'.
     * If variable name starts with an underscore character, the variable does not contain user data (PII) and can be safely used for telemetry purposes.
     */
    format: string;
  
    /**
     * An object used as a dictionary for looking up the variables in the format string.
     */
    variables?: { [key: string]: string };
  
    /**
     * If true send to telemetry.
     */
    sendTelemetry?: boolean;
  
    /**
     * If true show user.
     */
    showUser?: boolean;
  
    /**
     * An optional url where additional information about this message can be found.
     */
    url?: string;
  
    /**
     * An optional label that is presented to the user as the UI for opening the url.
     */
    urlLabel?: string;
  };
  
  export type Error = {
    __errorMarker: boolean;
    error: Message;
  };

  export type integer = number;

  export interface Api {
    /**
     * The `cancel` request is used by the client in two situations:
     * - to indicate that it is no longer interested in the result produced by a specific request issued earlier
     * - to cancel a progress sequence. Clients should only call this request if the corresponding capability `supportsCancelRequest` is true.
     * This request has a hint characteristic: a debug adapter can only be expected to make a 'best effort' in honoring this request but there are no guarantees.
     * The `cancel` request may return an error if it could not cancel an operation but a client should refrain from presenting this error to end users.
     * The request that got cancelled still needs to send a response back. This can either be a normal result (`success` attribute true) or an error response (`success` attribute false and the `message` set to `cancelled`).
     * Returning partial results from a cancelled request is possible but please note that a client has no generic way for detecting that a response is partial or not.
     * The progress that got cancelled still needs to send a `progressEnd` event back.
     *  A client should not assume that progress just got cancelled after sending the `cancel` request.
     */
    on(
      request: 'cancel',
      handler: (params: CancelParams) => Promise<CancelResult | Error>,
    ): () => void;
    /**
     * The `cancel` request is used by the client in two situations:
     * - to indicate that it is no longer interested in the result produced by a specific request issued earlier
     * - to cancel a progress sequence. Clients should only call this request if the corresponding capability `supportsCancelRequest` is true.
     * This request has a hint characteristic: a debug adapter can only be expected to make a 'best effort' in honoring this request but there are no guarantees.
     * The `cancel` request may return an error if it could not cancel an operation but a client should refrain from presenting this error to end users.
     * The request that got cancelled still needs to send a response back. This can either be a normal result (`success` attribute true) or an error response (`success` attribute false and the `message` set to `cancelled`).
     * Returning partial results from a cancelled request is possible but please note that a client has no generic way for detecting that a response is partial or not.
     * The progress that got cancelled still needs to send a `progressEnd` event back.
     *  A client should not assume that progress just got cancelled after sending the `cancel` request.
     */
    cancelRequest(params: CancelParams): Promise<CancelResult>;

    /**
     * This event indicates that the debug adapter is ready to accept configuration requests (e.g. `setBreakpoints`, `setExceptionBreakpoints`).
     * A debug adapter is expected to send this event when it is ready to accept configuration requests (but not before the `initialize` request has finished).
     * The sequence of events/requests is as follows:
     * - adapters sends `initialized` event (after the `initialize` request has returned)
     * - client sends zero or more `setBreakpoints` requests
     * - client sends one `setFunctionBreakpoints` request (if corresponding capability `supportsFunctionBreakpoints` is true)
     * - client sends a `setExceptionBreakpoints` request if one or more `exceptionBreakpointFilters` have been defined (or if `supportsConfigurationDoneRequest` is not true)
     * - client sends other future configuration requests
     * - client sends one `configurationDone` request to indicate the end of the configuration.
     */
    initialized(params: InitializedEventParams): void;

    /**
     * The event indicates that the execution of the debuggee has stopped due to some condition.
     * This can be caused by a breakpoint previously set, a stepping request has completed, by executing a debugger statement etc.
     */
    stopped(params: StoppedEventParams): void;

    /**
     * The event indicates that the execution of the debuggee has continued.
     * Please note: a debug adapter is not expected to send this event in response to a request that implies that execution continues, e.g. `launch` or `continue`.
     * It is only necessary to send a `continued` event if there was no previous request that implied this.
     */
    continued(params: ContinuedEventParams): void;

    /**
     * The event indicates that the debuggee has exited and returns its exit code.
     */
    exited(params: ExitedEventParams): void;

    /**
     * The event indicates that debugging of the debuggee has terminated. This does **not** mean that the debuggee itself has exited.
     */
    terminated(params: TerminatedEventParams): void;

    /**
     * The event indicates that a thread has started or exited.
     */
    thread(params: ThreadEventParams): void;

    /**
     * The event indicates that the target has produced some output.
     */
    output(params: OutputEventParams): void;

    /**
     * The event indicates that some information about a breakpoint has changed.
     */
    breakpoint(params: BreakpointEventParams): void;

    /**
     * The event indicates that some information about a module has changed.
     */
    module(params: ModuleEventParams): void;

    /**
     * The event indicates that some source has been added, changed, or removed from the set of all loaded sources.
     */
    loadedSource(params: LoadedSourceEventParams): void;

    /**
     * The event indicates that the debugger has begun debugging a new process. Either one that it has launched, or one that it has attached to.
     */
    process(params: ProcessEventParams): void;

    /**
     * The event indicates that one or more capabilities have changed.
     * Since the capabilities are dependent on the client and its UI, it might not be possible to change that at random times (or too late).
     * Consequently this event has a hint characteristic: a client can only be expected to make a 'best effort' in honoring individual capabilities but there are no guarantees.
     * Only changed capabilities need to be included, all other capabilities keep their values.
     */
    capabilities(params: CapabilitiesEventParams): void;

    /**
     * The event signals that a long running operation is about to start and provides additional information for the client to set up a corresponding progress and cancellation UI.
     * The client is free to delay the showing of the UI in order to reduce flicker.
     * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
     */
    progressStart(params: ProgressStartEventParams): void;

    /**
     * The event signals that the progress reporting needs to be updated with a new message and/or percentage.
     * The client does not have to update the UI immediately, but the clients needs to keep track of the message and/or percentage values.
     * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
     */
    progressUpdate(params: ProgressUpdateEventParams): void;

    /**
     * The event signals the end of the progress reporting with a final message.
     * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
     */
    progressEnd(params: ProgressEndEventParams): void;

    /**
     * This event signals that some state in the debug adapter has changed and requires that the client needs to re-render the data snapshot previously requested.
     * Debug adapters do not have to emit this event for runtime changes like stopped or thread events because in that case the client refetches the new state anyway. But the event can be used for example to refresh the UI after rendering formatting has changed in the debug adapter.
     * This event should only be sent if the corresponding capability `supportsInvalidatedEvent` is true.
     */
    invalidated(params: InvalidatedEventParams): void;

    /**
     * This event indicates that some memory range has been updated. It should only be sent if the corresponding capability `supportsMemoryEvent` is true.
     * Clients typically react to the event by re-issuing a `readMemory` request if they show the memory identified by the `memoryReference` and if the updated memory range overlaps the displayed range. Clients should not make assumptions how individual memory references relate to each other, so they should not assume that they are part of a single continuous address range and might overlap.
     * Debug adapters can use this event to indicate that the contents of a memory range has changed due to some other request like `setVariable` or `setExpression`. Debug adapters are not expected to emit this event for each and every memory change of a running program, because that information is typically not available from debuggers and it would flood clients with too many events.
     */
    memory(params: MemoryEventParams): void;

    /**
     * This request is sent from the debug adapter to the client to run a command in a terminal.
     * This is typically used to launch the debuggee in a terminal provided by the client.
     * This request should only be called if the corresponding client capability `supportsRunInTerminalRequest` is true.
     * Client implementations of `runInTerminal` are free to run the command however they choose including issuing the command to a command line interpreter (aka 'shell'). Argument strings passed to the `runInTerminal` request must arrive verbatim in the command to be run. As a consequence, clients which use a shell are responsible for escaping any special shell characters in the argument strings to prevent them from being interpreted (and modified) by the shell.
     * Some users may wish to take advantage of shell processing in the argument strings. For clients which implement `runInTerminal` using an intermediary shell, the `argsCanBeInterpretedByShell` property can be set to true. In this case the client is requested not to escape any special shell characters in the argument strings.
     */
    on(
      request: 'runInTerminal',
      handler: (params: RunInTerminalParams) => Promise<RunInTerminalResult | Error>,
    ): () => void;
    /**
     * This request is sent from the debug adapter to the client to run a command in a terminal.
     * This is typically used to launch the debuggee in a terminal provided by the client.
     * This request should only be called if the corresponding client capability `supportsRunInTerminalRequest` is true.
     * Client implementations of `runInTerminal` are free to run the command however they choose including issuing the command to a command line interpreter (aka 'shell'). Argument strings passed to the `runInTerminal` request must arrive verbatim in the command to be run. As a consequence, clients which use a shell are responsible for escaping any special shell characters in the argument strings to prevent them from being interpreted (and modified) by the shell.
     * Some users may wish to take advantage of shell processing in the argument strings. For clients which implement `runInTerminal` using an intermediary shell, the `argsCanBeInterpretedByShell` property can be set to true. In this case the client is requested not to escape any special shell characters in the argument strings.
     */
    runInTerminalRequest(params: RunInTerminalParams): Promise<RunInTerminalResult>;

    /**
     * This request is sent from the debug adapter to the client to start a new debug session of the same type as the caller.
     * This request should only be sent if the corresponding client capability `supportsStartDebuggingRequest` is true.
     * A client implementation of `startDebugging` should start a new debug session (of the same type as the caller) in the same way that the caller's session was started. If the client supports hierarchical debug sessions, the newly created session can be treated as a child of the caller session.
     */
    on(
      request: 'startDebugging',
      handler: (params: StartDebuggingParams) => Promise<StartDebuggingResult | Error>,
    ): () => void;
    /**
     * This request is sent from the debug adapter to the client to start a new debug session of the same type as the caller.
     * This request should only be sent if the corresponding client capability `supportsStartDebuggingRequest` is true.
     * A client implementation of `startDebugging` should start a new debug session (of the same type as the caller) in the same way that the caller's session was started. If the client supports hierarchical debug sessions, the newly created session can be treated as a child of the caller session.
     */
    startDebuggingRequest(params: StartDebuggingParams): Promise<StartDebuggingResult>;

    /**
     * The `initialize` request is sent as the first request from the client to the debug adapter in order to configure it with client capabilities and to retrieve capabilities from the debug adapter.
     * Until the debug adapter has responded with an `initialize` response, the client must not send any additional requests or events to the debug adapter.
     * In addition the debug adapter is not allowed to send any requests or events to the client until it has responded with an `initialize` response.
     * The `initialize` request may only be sent once.
     */
    on(
      request: 'initialize',
      handler: (params: InitializeParams) => Promise<InitializeResult | Error>,
    ): () => void;
    /**
     * The `initialize` request is sent as the first request from the client to the debug adapter in order to configure it with client capabilities and to retrieve capabilities from the debug adapter.
     * Until the debug adapter has responded with an `initialize` response, the client must not send any additional requests or events to the debug adapter.
     * In addition the debug adapter is not allowed to send any requests or events to the client until it has responded with an `initialize` response.
     * The `initialize` request may only be sent once.
     */
    initializeRequest(params: InitializeParams): Promise<InitializeResult>;

    /**
     * This request indicates that the client has finished initialization of the debug adapter.
     * So it is the last request in the sequence of configuration requests (which was started by the `initialized` event).
     * Clients should only call this request if the corresponding capability `supportsConfigurationDoneRequest` is true.
     */
    on(
      request: 'configurationDone',
      handler: (params: ConfigurationDoneParams) => Promise<ConfigurationDoneResult | Error>,
    ): () => void;
    /**
     * This request indicates that the client has finished initialization of the debug adapter.
     * So it is the last request in the sequence of configuration requests (which was started by the `initialized` event).
     * Clients should only call this request if the corresponding capability `supportsConfigurationDoneRequest` is true.
     */
    configurationDoneRequest(params: ConfigurationDoneParams): Promise<ConfigurationDoneResult>;

    /**
     * This launch request is sent from the client to the debug adapter to start the debuggee with or without debugging (if `noDebug` is true).
     * Since launching is debugger/runtime specific, the arguments for this request are not part of this specification.
     */
    on(
      request: 'launch',
      handler: (params: LaunchParams) => Promise<LaunchResult | Error>,
    ): () => void;
    /**
     * This launch request is sent from the client to the debug adapter to start the debuggee with or without debugging (if `noDebug` is true).
     * Since launching is debugger/runtime specific, the arguments for this request are not part of this specification.
     */
    launchRequest(params: LaunchParams): Promise<LaunchResult>;

    /**
     * The `attach` request is sent from the client to the debug adapter to attach to a debuggee that is already running.
     * Since attaching is debugger/runtime specific, the arguments for this request are not part of this specification.
     */
    on(
      request: 'attach',
      handler: (params: AttachParams) => Promise<AttachResult | Error>,
    ): () => void;
    /**
     * The `attach` request is sent from the client to the debug adapter to attach to a debuggee that is already running.
     * Since attaching is debugger/runtime specific, the arguments for this request are not part of this specification.
     */
    attachRequest(params: AttachParams): Promise<AttachResult>;

    /**
     * Restarts a debug session. Clients should only call this request if the corresponding capability `supportsRestartRequest` is true.
     * If the capability is missing or has the value false, a typical client emulates `restart` by terminating the debug adapter first and then launching it anew.
     */
    on(
      request: 'restart',
      handler: (params: RestartParams) => Promise<RestartResult | Error>,
    ): () => void;
    /**
     * Restarts a debug session. Clients should only call this request if the corresponding capability `supportsRestartRequest` is true.
     * If the capability is missing or has the value false, a typical client emulates `restart` by terminating the debug adapter first and then launching it anew.
     */
    restartRequest(params: RestartParams): Promise<RestartResult>;

    /**
     * The `disconnect` request asks the debug adapter to disconnect from the debuggee (thus ending the debug session) and then to shut down itself (the debug adapter).
     * In addition, the debug adapter must terminate the debuggee if it was started with the `launch` request. If an `attach` request was used to connect to the debuggee, then the debug adapter must not terminate the debuggee.
     * This implicit behavior of when to terminate the debuggee can be overridden with the `terminateDebuggee` argument (which is only supported by a debug adapter if the corresponding capability `supportTerminateDebuggee` is true).
     */
    on(
      request: 'disconnect',
      handler: (params: DisconnectParams) => Promise<DisconnectResult | Error>,
    ): () => void;
    /**
     * The `disconnect` request asks the debug adapter to disconnect from the debuggee (thus ending the debug session) and then to shut down itself (the debug adapter).
     * In addition, the debug adapter must terminate the debuggee if it was started with the `launch` request. If an `attach` request was used to connect to the debuggee, then the debug adapter must not terminate the debuggee.
     * This implicit behavior of when to terminate the debuggee can be overridden with the `terminateDebuggee` argument (which is only supported by a debug adapter if the corresponding capability `supportTerminateDebuggee` is true).
     */
    disconnectRequest(params: DisconnectParams): Promise<DisconnectResult>;

    /**
     * The `terminate` request is sent from the client to the debug adapter in order to shut down the debuggee gracefully. Clients should only call this request if the capability `supportsTerminateRequest` is true.
     * Typically a debug adapter implements `terminate` by sending a software signal which the debuggee intercepts in order to clean things up properly before terminating itself.
     * Please note that this request does not directly affect the state of the debug session: if the debuggee decides to veto the graceful shutdown for any reason by not terminating itself, then the debug session just continues.
     * Clients can surface the `terminate` request as an explicit command or they can integrate it into a two stage Stop command that first sends `terminate` to request a graceful shutdown, and if that fails uses `disconnect` for a forceful shutdown.
     */
    on(
      request: 'terminate',
      handler: (params: TerminateParams) => Promise<TerminateResult | Error>,
    ): () => void;
    /**
     * The `terminate` request is sent from the client to the debug adapter in order to shut down the debuggee gracefully. Clients should only call this request if the capability `supportsTerminateRequest` is true.
     * Typically a debug adapter implements `terminate` by sending a software signal which the debuggee intercepts in order to clean things up properly before terminating itself.
     * Please note that this request does not directly affect the state of the debug session: if the debuggee decides to veto the graceful shutdown for any reason by not terminating itself, then the debug session just continues.
     * Clients can surface the `terminate` request as an explicit command or they can integrate it into a two stage Stop command that first sends `terminate` to request a graceful shutdown, and if that fails uses `disconnect` for a forceful shutdown.
     */
    terminateRequest(params: TerminateParams): Promise<TerminateResult>;

    /**
     * The `breakpointLocations` request returns all possible locations for source breakpoints in a given range.
     * Clients should only call this request if the corresponding capability `supportsBreakpointLocationsRequest` is true.
     */
    on(
      request: 'breakpointLocations',
      handler: (params: BreakpointLocationsParams) => Promise<BreakpointLocationsResult | Error>,
    ): () => void;
    /**
     * The `breakpointLocations` request returns all possible locations for source breakpoints in a given range.
     * Clients should only call this request if the corresponding capability `supportsBreakpointLocationsRequest` is true.
     */
    breakpointLocationsRequest(
      params: BreakpointLocationsParams,
    ): Promise<BreakpointLocationsResult>;

    /**
     * Sets multiple breakpoints for a single source and clears all previous breakpoints in that source.
     * To clear all breakpoint for a source, specify an empty array.
     * When a breakpoint is hit, a `stopped` event (with reason `breakpoint`) is generated.
     */
    on(
      request: 'setBreakpoints',
      handler: (params: SetBreakpointsParams) => Promise<SetBreakpointsResult | Error>,
    ): () => void;
    /**
     * Sets multiple breakpoints for a single source and clears all previous breakpoints in that source.
     * To clear all breakpoint for a source, specify an empty array.
     * When a breakpoint is hit, a `stopped` event (with reason `breakpoint`) is generated.
     */
    setBreakpointsRequest(params: SetBreakpointsParams): Promise<SetBreakpointsResult>;

    /**
     * Replaces all existing function breakpoints with new function breakpoints.
     * To clear all function breakpoints, specify an empty array.
     * When a function breakpoint is hit, a `stopped` event (with reason `function breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsFunctionBreakpoints` is true.
     */
    on(
      request: 'setFunctionBreakpoints',
      handler: (
        params: SetFunctionBreakpointsParams,
      ) => Promise<SetFunctionBreakpointsResult | Error>,
    ): () => void;
    /**
     * Replaces all existing function breakpoints with new function breakpoints.
     * To clear all function breakpoints, specify an empty array.
     * When a function breakpoint is hit, a `stopped` event (with reason `function breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsFunctionBreakpoints` is true.
     */
    setFunctionBreakpointsRequest(
      params: SetFunctionBreakpointsParams,
    ): Promise<SetFunctionBreakpointsResult>;

    /**
     * The request configures the debugger's response to thrown exceptions.
     * If an exception is configured to break, a `stopped` event is fired (with reason `exception`).
     * Clients should only call this request if the corresponding capability `exceptionBreakpointFilters` returns one or more filters.
     */
    on(
      request: 'setExceptionBreakpoints',
      handler: (
        params: SetExceptionBreakpointsParams,
      ) => Promise<SetExceptionBreakpointsResult | Error>,
    ): () => void;
    /**
     * The request configures the debugger's response to thrown exceptions.
     * If an exception is configured to break, a `stopped` event is fired (with reason `exception`).
     * Clients should only call this request if the corresponding capability `exceptionBreakpointFilters` returns one or more filters.
     */
    setExceptionBreakpointsRequest(
      params: SetExceptionBreakpointsParams,
    ): Promise<SetExceptionBreakpointsResult>;

    /**
     * Obtains information on a possible data breakpoint that could be set on an expression or variable.
     * Clients should only call this request if the corresponding capability `supportsDataBreakpoints` is true.
     */
    on(
      request: 'dataBreakpointInfo',
      handler: (params: DataBreakpointInfoParams) => Promise<DataBreakpointInfoResult | Error>,
    ): () => void;
    /**
     * Obtains information on a possible data breakpoint that could be set on an expression or variable.
     * Clients should only call this request if the corresponding capability `supportsDataBreakpoints` is true.
     */
    dataBreakpointInfoRequest(params: DataBreakpointInfoParams): Promise<DataBreakpointInfoResult>;

    /**
     * Replaces all existing data breakpoints with new data breakpoints.
     * To clear all data breakpoints, specify an empty array.
     * When a data breakpoint is hit, a `stopped` event (with reason `data breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsDataBreakpoints` is true.
     */
    on(
      request: 'setDataBreakpoints',
      handler: (params: SetDataBreakpointsParams) => Promise<SetDataBreakpointsResult | Error>,
    ): () => void;
    /**
     * Replaces all existing data breakpoints with new data breakpoints.
     * To clear all data breakpoints, specify an empty array.
     * When a data breakpoint is hit, a `stopped` event (with reason `data breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsDataBreakpoints` is true.
     */
    setDataBreakpointsRequest(params: SetDataBreakpointsParams): Promise<SetDataBreakpointsResult>;

    /**
     * Replaces all existing instruction breakpoints. Typically, instruction breakpoints would be set from a disassembly window.
     * To clear all instruction breakpoints, specify an empty array.
     * When an instruction breakpoint is hit, a `stopped` event (with reason `instruction breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsInstructionBreakpoints` is true.
     */
    on(
      request: 'setInstructionBreakpoints',
      handler: (
        params: SetInstructionBreakpointsParams,
      ) => Promise<SetInstructionBreakpointsResult | Error>,
    ): () => void;
    /**
     * Replaces all existing instruction breakpoints. Typically, instruction breakpoints would be set from a disassembly window.
     * To clear all instruction breakpoints, specify an empty array.
     * When an instruction breakpoint is hit, a `stopped` event (with reason `instruction breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsInstructionBreakpoints` is true.
     */
    setInstructionBreakpointsRequest(
      params: SetInstructionBreakpointsParams,
    ): Promise<SetInstructionBreakpointsResult>;

    /**
     * The request resumes execution of all threads. If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true resumes only the specified thread. If not all threads were resumed, the `allThreadsContinued` attribute of the response should be set to false.
     */
    on(
      request: 'continue',
      handler: (params: ContinueParams) => Promise<ContinueResult | Error>,
    ): () => void;
    /**
     * The request resumes execution of all threads. If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true resumes only the specified thread. If not all threads were resumed, the `allThreadsContinued` attribute of the response should be set to false.
     */
    continueRequest(params: ContinueParams): Promise<ContinueResult>;

    /**
     * The request executes one step (in the given granularity) for the specified thread and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     */
    on(request: 'next', handler: (params: NextParams) => Promise<NextResult | Error>): () => void;
    /**
     * The request executes one step (in the given granularity) for the specified thread and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     */
    nextRequest(params: NextParams): Promise<NextResult>;

    /**
     * The request resumes the given thread to step into a function/method and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * If the request cannot step into a target, `stepIn` behaves like the `next` request.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     * If there are multiple function/method calls (or other targets) on the source line,
     * the argument `targetId` can be used to control into which target the `stepIn` should occur.
     * The list of possible targets for a given source line can be retrieved via the `stepInTargets` request.
     */
    on(
      request: 'stepIn',
      handler: (params: StepInParams) => Promise<StepInResult | Error>,
    ): () => void;
    /**
     * The request resumes the given thread to step into a function/method and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * If the request cannot step into a target, `stepIn` behaves like the `next` request.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     * If there are multiple function/method calls (or other targets) on the source line,
     * the argument `targetId` can be used to control into which target the `stepIn` should occur.
     * The list of possible targets for a given source line can be retrieved via the `stepInTargets` request.
     */
    stepInRequest(params: StepInParams): Promise<StepInResult>;

    /**
     * The request resumes the given thread to step out (return) from a function/method and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     */
    on(
      request: 'stepOut',
      handler: (params: StepOutParams) => Promise<StepOutResult | Error>,
    ): () => void;
    /**
     * The request resumes the given thread to step out (return) from a function/method and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     */
    stepOutRequest(params: StepOutParams): Promise<StepOutResult>;

    /**
     * The request executes one backward step (in the given granularity) for the specified thread and allows all other threads to run backward freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     * Clients should only call this request if the corresponding capability `supportsStepBack` is true.
     */
    on(
      request: 'stepBack',
      handler: (params: StepBackParams) => Promise<StepBackResult | Error>,
    ): () => void;
    /**
     * The request executes one backward step (in the given granularity) for the specified thread and allows all other threads to run backward freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     * Clients should only call this request if the corresponding capability `supportsStepBack` is true.
     */
    stepBackRequest(params: StepBackParams): Promise<StepBackResult>;

    /**
     * The request resumes backward execution of all threads. If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true resumes only the specified thread. If not all threads were resumed, the `allThreadsContinued` attribute of the response should be set to false.
     * Clients should only call this request if the corresponding capability `supportsStepBack` is true.
     */
    on(
      request: 'reverseContinue',
      handler: (params: ReverseContinueParams) => Promise<ReverseContinueResult | Error>,
    ): () => void;
    /**
     * The request resumes backward execution of all threads. If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true resumes only the specified thread. If not all threads were resumed, the `allThreadsContinued` attribute of the response should be set to false.
     * Clients should only call this request if the corresponding capability `supportsStepBack` is true.
     */
    reverseContinueRequest(params: ReverseContinueParams): Promise<ReverseContinueResult>;

    /**
     * The request restarts execution of the specified stack frame.
     * The debug adapter first sends the response and then a `stopped` event (with reason `restart`) after the restart has completed.
     * Clients should only call this request if the corresponding capability `supportsRestartFrame` is true.
     */
    on(
      request: 'restartFrame',
      handler: (params: RestartFrameParams) => Promise<RestartFrameResult | Error>,
    ): () => void;
    /**
     * The request restarts execution of the specified stack frame.
     * The debug adapter first sends the response and then a `stopped` event (with reason `restart`) after the restart has completed.
     * Clients should only call this request if the corresponding capability `supportsRestartFrame` is true.
     */
    restartFrameRequest(params: RestartFrameParams): Promise<RestartFrameResult>;

    /**
     * The request sets the location where the debuggee will continue to run.
     * This makes it possible to skip the execution of code or to execute code again.
     * The code between the current location and the goto target is not executed but skipped.
     * The debug adapter first sends the response and then a `stopped` event with reason `goto`.
     * Clients should only call this request if the corresponding capability `supportsGotoTargetsRequest` is true (because only then goto targets exist that can be passed as arguments).
     */
    on(request: 'goto', handler: (params: GotoParams) => Promise<GotoResult | Error>): () => void;
    /**
     * The request sets the location where the debuggee will continue to run.
     * This makes it possible to skip the execution of code or to execute code again.
     * The code between the current location and the goto target is not executed but skipped.
     * The debug adapter first sends the response and then a `stopped` event with reason `goto`.
     * Clients should only call this request if the corresponding capability `supportsGotoTargetsRequest` is true (because only then goto targets exist that can be passed as arguments).
     */
    gotoRequest(params: GotoParams): Promise<GotoResult>;

    /**
     * The request suspends the debuggee.
     * The debug adapter first sends the response and then a `stopped` event (with reason `pause`) after the thread has been paused successfully.
     */
    on(
      request: 'pause',
      handler: (params: PauseParams) => Promise<PauseResult | Error>,
    ): () => void;
    /**
     * The request suspends the debuggee.
     * The debug adapter first sends the response and then a `stopped` event (with reason `pause`) after the thread has been paused successfully.
     */
    pauseRequest(params: PauseParams): Promise<PauseResult>;

    /**
     * The request returns a stacktrace from the current execution state of a given thread.
     * A client can request all stack frames by omitting the startFrame and levels arguments. For performance-conscious clients and if the corresponding capability `supportsDelayedStackTraceLoading` is true, stack frames can be retrieved in a piecemeal way with the `startFrame` and `levels` arguments. The response of the `stackTrace` request may contain a `totalFrames` property that hints at the total number of frames in the stack. If a client needs this total number upfront, it can issue a request for a single (first) frame and depending on the value of `totalFrames` decide how to proceed. In any case a client should be prepared to receive fewer frames than requested, which is an indication that the end of the stack has been reached.
     */
    on(
      request: 'stackTrace',
      handler: (params: StackTraceParams) => Promise<StackTraceResult | Error>,
    ): () => void;
    /**
     * The request returns a stacktrace from the current execution state of a given thread.
     * A client can request all stack frames by omitting the startFrame and levels arguments. For performance-conscious clients and if the corresponding capability `supportsDelayedStackTraceLoading` is true, stack frames can be retrieved in a piecemeal way with the `startFrame` and `levels` arguments. The response of the `stackTrace` request may contain a `totalFrames` property that hints at the total number of frames in the stack. If a client needs this total number upfront, it can issue a request for a single (first) frame and depending on the value of `totalFrames` decide how to proceed. In any case a client should be prepared to receive fewer frames than requested, which is an indication that the end of the stack has been reached.
     */
    stackTraceRequest(params: StackTraceParams): Promise<StackTraceResult>;

    /**
     * The request returns the variable scopes for a given stack frame ID.
     */
    on(
      request: 'scopes',
      handler: (params: ScopesParams) => Promise<ScopesResult | Error>,
    ): () => void;
    /**
     * The request returns the variable scopes for a given stack frame ID.
     */
    scopesRequest(params: ScopesParams): Promise<ScopesResult>;

    /**
     * Retrieves all child variables for the given variable reference.
     * A filter can be used to limit the fetched children to either named or indexed children.
     */
    on(
      request: 'variables',
      handler: (params: VariablesParams) => Promise<VariablesResult | Error>,
    ): () => void;
    /**
     * Retrieves all child variables for the given variable reference.
     * A filter can be used to limit the fetched children to either named or indexed children.
     */
    variablesRequest(params: VariablesParams): Promise<VariablesResult>;

    /**
     * Set the variable with the given name in the variable container to a new value. Clients should only call this request if the corresponding capability `supportsSetVariable` is true.
     * If a debug adapter implements both `setVariable` and `setExpression`, a client will only use `setExpression` if the variable has an `evaluateName` property.
     */
    on(
      request: 'setVariable',
      handler: (params: SetVariableParams) => Promise<SetVariableResult | Error>,
    ): () => void;
    /**
     * Set the variable with the given name in the variable container to a new value. Clients should only call this request if the corresponding capability `supportsSetVariable` is true.
     * If a debug adapter implements both `setVariable` and `setExpression`, a client will only use `setExpression` if the variable has an `evaluateName` property.
     */
    setVariableRequest(params: SetVariableParams): Promise<SetVariableResult>;

    /**
     * The request retrieves the source code for a given source reference.
     */
    on(
      request: 'source',
      handler: (params: SourceParams) => Promise<SourceResult | Error>,
    ): () => void;
    /**
     * The request retrieves the source code for a given source reference.
     */
    sourceRequest(params: SourceParams): Promise<SourceResult>;

    /**
     * The request retrieves a list of all threads.
     */
    on(
      request: 'threads',
      handler: (params: ThreadsParams) => Promise<ThreadsResult | Error>,
    ): () => void;
    /**
     * The request retrieves a list of all threads.
     */
    threadsRequest(params: ThreadsParams): Promise<ThreadsResult>;

    /**
     * The request terminates the threads with the given ids.
     * Clients should only call this request if the corresponding capability `supportsTerminateThreadsRequest` is true.
     */
    on(
      request: 'terminateThreads',
      handler: (params: TerminateThreadsParams) => Promise<TerminateThreadsResult | Error>,
    ): () => void;
    /**
     * The request terminates the threads with the given ids.
     * Clients should only call this request if the corresponding capability `supportsTerminateThreadsRequest` is true.
     */
    terminateThreadsRequest(params: TerminateThreadsParams): Promise<TerminateThreadsResult>;

    /**
     * Modules can be retrieved from the debug adapter with this request which can either return all modules or a range of modules to support paging.
     * Clients should only call this request if the corresponding capability `supportsModulesRequest` is true.
     */
    on(
      request: 'modules',
      handler: (params: ModulesParams) => Promise<ModulesResult | Error>,
    ): () => void;
    /**
     * Modules can be retrieved from the debug adapter with this request which can either return all modules or a range of modules to support paging.
     * Clients should only call this request if the corresponding capability `supportsModulesRequest` is true.
     */
    modulesRequest(params: ModulesParams): Promise<ModulesResult>;

    /**
     * Retrieves the set of all sources currently loaded by the debugged process.
     * Clients should only call this request if the corresponding capability `supportsLoadedSourcesRequest` is true.
     */
    on(
      request: 'loadedSources',
      handler: (params: LoadedSourcesParams) => Promise<LoadedSourcesResult | Error>,
    ): () => void;
    /**
     * Retrieves the set of all sources currently loaded by the debugged process.
     * Clients should only call this request if the corresponding capability `supportsLoadedSourcesRequest` is true.
     */
    loadedSourcesRequest(params: LoadedSourcesParams): Promise<LoadedSourcesResult>;

    /**
     * Evaluates the given expression in the context of the topmost stack frame.
     * The expression has access to any variables and arguments that are in scope.
     */
    on(
      request: 'evaluate',
      handler: (params: EvaluateParams) => Promise<EvaluateResult | Error>,
    ): () => void;
    /**
     * Evaluates the given expression in the context of the topmost stack frame.
     * The expression has access to any variables and arguments that are in scope.
     */
    evaluateRequest(params: EvaluateParams): Promise<EvaluateResult>;

    /**
     * Evaluates the given `value` expression and assigns it to the `expression` which must be a modifiable l-value.
     * The expressions have access to any variables and arguments that are in scope of the specified frame.
     * Clients should only call this request if the corresponding capability `supportsSetExpression` is true.
     * If a debug adapter implements both `setExpression` and `setVariable`, a client uses `setExpression` if the variable has an `evaluateName` property.
     */
    on(
      request: 'setExpression',
      handler: (params: SetExpressionParams) => Promise<SetExpressionResult | Error>,
    ): () => void;
    /**
     * Evaluates the given `value` expression and assigns it to the `expression` which must be a modifiable l-value.
     * The expressions have access to any variables and arguments that are in scope of the specified frame.
     * Clients should only call this request if the corresponding capability `supportsSetExpression` is true.
     * If a debug adapter implements both `setExpression` and `setVariable`, a client uses `setExpression` if the variable has an `evaluateName` property.
     */
    setExpressionRequest(params: SetExpressionParams): Promise<SetExpressionResult>;

    /**
     * This request retrieves the possible step-in targets for the specified stack frame.
     * These targets can be used in the `stepIn` request.
     * Clients should only call this request if the corresponding capability `supportsStepInTargetsRequest` is true.
     */
    on(
      request: 'stepInTargets',
      handler: (params: StepInTargetsParams) => Promise<StepInTargetsResult | Error>,
    ): () => void;
    /**
     * This request retrieves the possible step-in targets for the specified stack frame.
     * These targets can be used in the `stepIn` request.
     * Clients should only call this request if the corresponding capability `supportsStepInTargetsRequest` is true.
     */
    stepInTargetsRequest(params: StepInTargetsParams): Promise<StepInTargetsResult>;

    /**
     * This request retrieves the possible goto targets for the specified source location.
     * These targets can be used in the `goto` request.
     * Clients should only call this request if the corresponding capability `supportsGotoTargetsRequest` is true.
     */
    on(
      request: 'gotoTargets',
      handler: (params: GotoTargetsParams) => Promise<GotoTargetsResult | Error>,
    ): () => void;
    /**
     * This request retrieves the possible goto targets for the specified source location.
     * These targets can be used in the `goto` request.
     * Clients should only call this request if the corresponding capability `supportsGotoTargetsRequest` is true.
     */
    gotoTargetsRequest(params: GotoTargetsParams): Promise<GotoTargetsResult>;

    /**
     * Returns a list of possible completions for a given caret position and text.
     * Clients should only call this request if the corresponding capability `supportsCompletionsRequest` is true.
     */
    on(
      request: 'completions',
      handler: (params: CompletionsParams) => Promise<CompletionsResult | Error>,
    ): () => void;
    /**
     * Returns a list of possible completions for a given caret position and text.
     * Clients should only call this request if the corresponding capability `supportsCompletionsRequest` is true.
     */
    completionsRequest(params: CompletionsParams): Promise<CompletionsResult>;

    /**
     * Retrieves the details of the exception that caused this event to be raised.
     * Clients should only call this request if the corresponding capability `supportsExceptionInfoRequest` is true.
     */
    on(
      request: 'exceptionInfo',
      handler: (params: ExceptionInfoParams) => Promise<ExceptionInfoResult | Error>,
    ): () => void;
    /**
     * Retrieves the details of the exception that caused this event to be raised.
     * Clients should only call this request if the corresponding capability `supportsExceptionInfoRequest` is true.
     */
    exceptionInfoRequest(params: ExceptionInfoParams): Promise<ExceptionInfoResult>;

    /**
     * Reads bytes from memory at the provided location.
     * Clients should only call this request if the corresponding capability `supportsReadMemoryRequest` is true.
     */
    on(
      request: 'readMemory',
      handler: (params: ReadMemoryParams) => Promise<ReadMemoryResult | Error>,
    ): () => void;
    /**
     * Reads bytes from memory at the provided location.
     * Clients should only call this request if the corresponding capability `supportsReadMemoryRequest` is true.
     */
    readMemoryRequest(params: ReadMemoryParams): Promise<ReadMemoryResult>;

    /**
     * Writes bytes to memory at the provided location.
     * Clients should only call this request if the corresponding capability `supportsWriteMemoryRequest` is true.
     */
    on(
      request: 'writeMemory',
      handler: (params: WriteMemoryParams) => Promise<WriteMemoryResult | Error>,
    ): () => void;
    /**
     * Writes bytes to memory at the provided location.
     * Clients should only call this request if the corresponding capability `supportsWriteMemoryRequest` is true.
     */
    writeMemoryRequest(params: WriteMemoryParams): Promise<WriteMemoryResult>;

    /**
     * Disassembles code stored at the provided location.
     * Clients should only call this request if the corresponding capability `supportsDisassembleRequest` is true.
     */
    on(
      request: 'disassemble',
      handler: (params: DisassembleParams) => Promise<DisassembleResult | Error>,
    ): () => void;
    /**
     * Disassembles code stored at the provided location.
     * Clients should only call this request if the corresponding capability `supportsDisassembleRequest` is true.
     */
    disassembleRequest(params: DisassembleParams): Promise<DisassembleResult>;

    /**
     * Enable custom breakpoints.
     */
    on(
      request: 'enableCustomBreakpoints',
      handler: (
        params: EnableCustomBreakpointsParams,
      ) => Promise<EnableCustomBreakpointsResult | Error>,
    ): () => void;
    /**
     * Enable custom breakpoints.
     */
    enableCustomBreakpointsRequest(
      params: EnableCustomBreakpointsParams,
    ): Promise<EnableCustomBreakpointsResult>;

    /**
     * Disable custom breakpoints.
     */
    on(
      request: 'disableCustomBreakpoints',
      handler: (
        params: DisableCustomBreakpointsParams,
      ) => Promise<DisableCustomBreakpointsResult | Error>,
    ): () => void;
    /**
     * Disable custom breakpoints.
     */
    disableCustomBreakpointsRequest(
      params: DisableCustomBreakpointsParams,
    ): Promise<DisableCustomBreakpointsResult>;

    /**
     * Pretty prints source for debugging.
     */
    on(
      request: 'prettyPrintSource',
      handler: (params: PrettyPrintSourceParams) => Promise<PrettyPrintSourceResult | Error>,
    ): () => void;
    /**
     * Pretty prints source for debugging.
     */
    prettyPrintSourceRequest(params: PrettyPrintSourceParams): Promise<PrettyPrintSourceResult>;

    /**
     * Toggle skip status of file.
     */
    on(
      request: 'toggleSkipFileStatus',
      handler: (params: ToggleSkipFileStatusParams) => Promise<ToggleSkipFileStatusResult | Error>,
    ): () => void;
    /**
     * Toggle skip status of file.
     */
    toggleSkipFileStatusRequest(
      params: ToggleSkipFileStatusParams,
    ): Promise<ToggleSkipFileStatusResult>;

    /**
     * A request to reveal a certain location in the UI.
     */
    revealLocationRequested(params: RevealLocationRequestedEventParams): void;

    /**
     * A request to copy a certain string to clipboard.
     */
    copyRequested(params: CopyRequestedEventParams): void;

    /**
     * An event sent when breakpoint prediction takes a significant amount of time.
     */
    longPrediction(params: LongPredictionEventParams): void;

    /**
     * Request to launch a browser in the companion extension within the UI.
     */
    launchBrowserInCompanion(params: LaunchBrowserInCompanionEventParams): void;

    /**
     * Kills a launched browser companion.
     */
    killCompanionBrowser(params: KillCompanionBrowserEventParams): void;

    /**
     * Starts taking a profile of the target.
     */
    on(
      request: 'startProfile',
      handler: (params: StartProfileParams) => Promise<StartProfileResult | Error>,
    ): () => void;
    /**
     * Starts taking a profile of the target.
     */
    startProfileRequest(params: StartProfileParams): Promise<StartProfileResult>;

    /**
     * Stops a running profile.
     */
    on(
      request: 'stopProfile',
      handler: (params: StopProfileParams) => Promise<StopProfileResult | Error>,
    ): () => void;
    /**
     * Stops a running profile.
     */
    stopProfileRequest(params: StopProfileParams): Promise<StopProfileResult>;

    /**
     * Fired when a profiling state changes.
     */
    profileStarted(params: ProfileStartedEventParams): void;

    /**
     * Fired when a profiling state changes.
     */
    profilerStateUpdate(params: ProfilerStateUpdateEventParams): void;

    /**
     * Launches a VS Code extension host in debug mode.
     */
    on(
      request: 'launchVSCode',
      handler: (params: LaunchVSCodeParams) => Promise<LaunchVSCodeResult | Error>,
    ): () => void;
    /**
     * Launches a VS Code extension host in debug mode.
     */
    launchVSCodeRequest(params: LaunchVSCodeParams): Promise<LaunchVSCodeResult>;

    /**
     * Launches a VS Code extension host in debug mode.
     */
    on(
      request: 'launchUnelevated',
      handler: (params: LaunchUnelevatedParams) => Promise<LaunchUnelevatedResult | Error>,
    ): () => void;
    /**
     * Launches a VS Code extension host in debug mode.
     */
    launchUnelevatedRequest(params: LaunchUnelevatedParams): Promise<LaunchUnelevatedResult>;

    /**
     * Check if file exists on remote file system, used in VS.
     */
    on(
      request: 'remoteFileExists',
      handler: (params: RemoteFileExistsParams) => Promise<RemoteFileExistsResult | Error>,
    ): () => void;
    /**
     * Check if file exists on remote file system, used in VS.
     */
    remoteFileExistsRequest(params: RemoteFileExistsParams): Promise<RemoteFileExistsResult>;

    /**
     * Focuses the browser page or tab associated with the session.
     */
    on(
      request: 'revealPage',
      handler: (params: RevealPageParams) => Promise<RevealPageResult | Error>,
    ): () => void;
    /**
     * Focuses the browser page or tab associated with the session.
     */
    revealPageRequest(params: RevealPageParams): Promise<RevealPageResult>;

    /**
     * Starts profiling the extension itself. Used by VS.
     */
    on(
      request: 'startSelfProfile',
      handler: (params: StartSelfProfileParams) => Promise<StartSelfProfileResult | Error>,
    ): () => void;
    /**
     * Starts profiling the extension itself. Used by VS.
     */
    startSelfProfileRequest(params: StartSelfProfileParams): Promise<StartSelfProfileResult>;

    /**
     * Stops profiling the extension itself. Used by VS.
     */
    on(
      request: 'stopSelfProfile',
      handler: (params: StopSelfProfileParams) => Promise<StopSelfProfileResult | Error>,
    ): () => void;
    /**
     * Stops profiling the extension itself. Used by VS.
     */
    stopSelfProfileRequest(params: StopSelfProfileParams): Promise<StopSelfProfileResult>;

    /**
     * Requests that we get performance information from the runtime.
     */
    on(
      request: 'getPerformance',
      handler: (params: GetPerformanceParams) => Promise<GetPerformanceResult | Error>,
    ): () => void;
    /**
     * Requests that we get performance information from the runtime.
     */
    getPerformanceRequest(params: GetPerformanceParams): Promise<GetPerformanceResult>;

    /**
     * Fired when requesting a missing source from a sourcemap. UI will offer to disable the sourcemap.
     */
    suggestDisableSourcemap(params: SuggestDisableSourcemapEventParams): void;

    /**
     * Disables the sourcemapped source and refreshes the stacktrace if paused.
     */
    on(
      request: 'disableSourcemap',
      handler: (params: DisableSourcemapParams) => Promise<DisableSourcemapResult | Error>,
    ): () => void;
    /**
     * Disables the sourcemapped source and refreshes the stacktrace if paused.
     */
    disableSourcemapRequest(params: DisableSourcemapParams): Promise<DisableSourcemapResult>;

    /**
     * Generates diagnostic information for the debug session.
     */
    on(
      request: 'createDiagnostics',
      handler: (params: CreateDiagnosticsParams) => Promise<CreateDiagnosticsResult | Error>,
    ): () => void;
    /**
     * Generates diagnostic information for the debug session.
     */
    createDiagnosticsRequest(params: CreateDiagnosticsParams): Promise<CreateDiagnosticsResult>;

    /**
     * Saves recent diagnostic logs for the debug session.
     */
    on(
      request: 'saveDiagnosticLogs',
      handler: (params: SaveDiagnosticLogsParams) => Promise<SaveDiagnosticLogsResult | Error>,
    ): () => void;
    /**
     * Saves recent diagnostic logs for the debug session.
     */
    saveDiagnosticLogsRequest(params: SaveDiagnosticLogsParams): Promise<SaveDiagnosticLogsResult>;

    /**
     * Shows a prompt to the user suggesting they use the diagnostic tool if breakpoints don't bind.
     */
    suggestDiagnosticTool(params: SuggestDiagnosticToolEventParams): void;

    /**
     * Opens the diagnostic tool if breakpoints don't bind.
     */
    openDiagnosticTool(params: OpenDiagnosticToolEventParams): void;

    /**
     * Request WebSocket connection information on a proxy for this debug sessions CDP connection.
     */
    on(
      request: 'requestCDPProxy',
      handler: (params: RequestCDPProxyParams) => Promise<RequestCDPProxyResult | Error>,
    ): () => void;
    /**
     * Request WebSocket connection information on a proxy for this debug sessions CDP connection.
     */
    requestCDPProxyRequest(params: RequestCDPProxyParams): Promise<RequestCDPProxyResult>;

    /**
     * Adds an excluded caller/target pair.
     */
    on(
      request: 'setExcludedCallers',
      handler: (params: SetExcludedCallersParams) => Promise<SetExcludedCallersResult | Error>,
    ): () => void;
    /**
     * Adds an excluded caller/target pair.
     */
    setExcludedCallersRequest(params: SetExcludedCallersParams): Promise<SetExcludedCallersResult>;

    /**
     * Configures whether source map stepping is enabled.
     */
    on(
      request: 'setSourceMapStepping',
      handler: (params: SetSourceMapSteppingParams) => Promise<SetSourceMapSteppingResult | Error>,
    ): () => void;
    /**
     * Configures whether source map stepping is enabled.
     */
    setSourceMapSteppingRequest(
      params: SetSourceMapSteppingParams,
    ): Promise<SetSourceMapSteppingResult>;

    /**
     * Sets debugger properties.
     */
    on(
      request: 'setDebuggerProperty',
      handler: (params: SetDebuggerPropertyParams) => Promise<SetDebuggerPropertyResult | Error>,
    ): () => void;
    /**
     * Sets debugger properties.
     */
    setDebuggerPropertyRequest(
      params: SetDebuggerPropertyParams,
    ): Promise<SetDebuggerPropertyResult>;

    /**
     * The event indicates that one or more capabilities have changed.
     */
    on(
      request: 'capabilitiesExtended',
      handler: (params: CapabilitiesExtendedParams) => Promise<CapabilitiesExtendedResult | Error>,
    ): () => void;
    /**
     * The event indicates that one or more capabilities have changed.
     */
    capabilitiesExtendedRequest(
      params: CapabilitiesExtendedParams,
    ): Promise<CapabilitiesExtendedResult>;

    /**
     * Used by evaluate and variables.
     */
    on(
      request: 'evaluationOptions',
      handler: (params: EvaluationOptionsParams) => Promise<EvaluationOptionsResult | Error>,
    ): () => void;
    /**
     * Used by evaluate and variables.
     */
    evaluationOptionsRequest(params: EvaluationOptionsParams): Promise<EvaluationOptionsResult>;

    /**
     * Sets options for locating symbols.
     */
    on(
      request: 'setSymbolOptions',
      handler: (params: SetSymbolOptionsParams) => Promise<SetSymbolOptionsResult | Error>,
    ): () => void;
    /**
     * Sets options for locating symbols.
     */
    setSymbolOptionsRequest(params: SetSymbolOptionsParams): Promise<SetSymbolOptionsResult>;
  }

  export interface TestApi {
    /**
     * The `cancel` request is used by the client in two situations:
     * - to indicate that it is no longer interested in the result produced by a specific request issued earlier
     * - to cancel a progress sequence. Clients should only call this request if the corresponding capability `supportsCancelRequest` is true.
     * This request has a hint characteristic: a debug adapter can only be expected to make a 'best effort' in honoring this request but there are no guarantees.
     * The `cancel` request may return an error if it could not cancel an operation but a client should refrain from presenting this error to end users.
     * The request that got cancelled still needs to send a response back. This can either be a normal result (`success` attribute true) or an error response (`success` attribute false and the `message` set to `cancelled`).
     * Returning partial results from a cancelled request is possible but please note that a client has no generic way for detecting that a response is partial or not.
     * The progress that got cancelled still needs to send a `progressEnd` event back.
     *  A client should not assume that progress just got cancelled after sending the `cancel` request.
     */
    cancel(params: CancelParams): Promise<CancelResult>;

    /**
     * This event indicates that the debug adapter is ready to accept configuration requests (e.g. `setBreakpoints`, `setExceptionBreakpoints`).
     * A debug adapter is expected to send this event when it is ready to accept configuration requests (but not before the `initialize` request has finished).
     * The sequence of events/requests is as follows:
     * - adapters sends `initialized` event (after the `initialize` request has returned)
     * - client sends zero or more `setBreakpoints` requests
     * - client sends one `setFunctionBreakpoints` request (if corresponding capability `supportsFunctionBreakpoints` is true)
     * - client sends a `setExceptionBreakpoints` request if one or more `exceptionBreakpointFilters` have been defined (or if `supportsConfigurationDoneRequest` is not true)
     * - client sends other future configuration requests
     * - client sends one `configurationDone` request to indicate the end of the configuration.
     */
    on(request: 'initialized', handler: (params: InitializedEventParams) => void): void;
    off(request: 'initialized', handler: (params: InitializedEventParams) => void): void;
    once(
      request: 'initialized',
      filter?: (event: InitializedEventParams) => boolean,
    ): Promise<InitializedEventParams>;

    /**
     * The event indicates that the execution of the debuggee has stopped due to some condition.
     * This can be caused by a breakpoint previously set, a stepping request has completed, by executing a debugger statement etc.
     */
    on(request: 'stopped', handler: (params: StoppedEventParams) => void): void;
    off(request: 'stopped', handler: (params: StoppedEventParams) => void): void;
    once(
      request: 'stopped',
      filter?: (event: StoppedEventParams) => boolean,
    ): Promise<StoppedEventParams>;

    /**
     * The event indicates that the execution of the debuggee has continued.
     * Please note: a debug adapter is not expected to send this event in response to a request that implies that execution continues, e.g. `launch` or `continue`.
     * It is only necessary to send a `continued` event if there was no previous request that implied this.
     */
    on(request: 'continued', handler: (params: ContinuedEventParams) => void): void;
    off(request: 'continued', handler: (params: ContinuedEventParams) => void): void;
    once(
      request: 'continued',
      filter?: (event: ContinuedEventParams) => boolean,
    ): Promise<ContinuedEventParams>;

    /**
     * The event indicates that the debuggee has exited and returns its exit code.
     */
    on(request: 'exited', handler: (params: ExitedEventParams) => void): void;
    off(request: 'exited', handler: (params: ExitedEventParams) => void): void;
    once(
      request: 'exited',
      filter?: (event: ExitedEventParams) => boolean,
    ): Promise<ExitedEventParams>;

    /**
     * The event indicates that debugging of the debuggee has terminated. This does **not** mean that the debuggee itself has exited.
     */
    on(request: 'terminated', handler: (params: TerminatedEventParams) => void): void;
    off(request: 'terminated', handler: (params: TerminatedEventParams) => void): void;
    once(
      request: 'terminated',
      filter?: (event: TerminatedEventParams) => boolean,
    ): Promise<TerminatedEventParams>;

    /**
     * The event indicates that a thread has started or exited.
     */
    on(request: 'thread', handler: (params: ThreadEventParams) => void): void;
    off(request: 'thread', handler: (params: ThreadEventParams) => void): void;
    once(
      request: 'thread',
      filter?: (event: ThreadEventParams) => boolean,
    ): Promise<ThreadEventParams>;

    /**
     * The event indicates that the target has produced some output.
     */
    on(request: 'output', handler: (params: OutputEventParams) => void): void;
    off(request: 'output', handler: (params: OutputEventParams) => void): void;
    once(
      request: 'output',
      filter?: (event: OutputEventParams) => boolean,
    ): Promise<OutputEventParams>;

    /**
     * The event indicates that some information about a breakpoint has changed.
     */
    on(request: 'breakpoint', handler: (params: BreakpointEventParams) => void): void;
    off(request: 'breakpoint', handler: (params: BreakpointEventParams) => void): void;
    once(
      request: 'breakpoint',
      filter?: (event: BreakpointEventParams) => boolean,
    ): Promise<BreakpointEventParams>;

    /**
     * The event indicates that some information about a module has changed.
     */
    on(request: 'module', handler: (params: ModuleEventParams) => void): void;
    off(request: 'module', handler: (params: ModuleEventParams) => void): void;
    once(
      request: 'module',
      filter?: (event: ModuleEventParams) => boolean,
    ): Promise<ModuleEventParams>;

    /**
     * The event indicates that some source has been added, changed, or removed from the set of all loaded sources.
     */
    on(request: 'loadedSource', handler: (params: LoadedSourceEventParams) => void): void;
    off(request: 'loadedSource', handler: (params: LoadedSourceEventParams) => void): void;
    once(
      request: 'loadedSource',
      filter?: (event: LoadedSourceEventParams) => boolean,
    ): Promise<LoadedSourceEventParams>;

    /**
     * The event indicates that the debugger has begun debugging a new process. Either one that it has launched, or one that it has attached to.
     */
    on(request: 'process', handler: (params: ProcessEventParams) => void): void;
    off(request: 'process', handler: (params: ProcessEventParams) => void): void;
    once(
      request: 'process',
      filter?: (event: ProcessEventParams) => boolean,
    ): Promise<ProcessEventParams>;

    /**
     * The event indicates that one or more capabilities have changed.
     * Since the capabilities are dependent on the client and its UI, it might not be possible to change that at random times (or too late).
     * Consequently this event has a hint characteristic: a client can only be expected to make a 'best effort' in honoring individual capabilities but there are no guarantees.
     * Only changed capabilities need to be included, all other capabilities keep their values.
     */
    on(request: 'capabilities', handler: (params: CapabilitiesEventParams) => void): void;
    off(request: 'capabilities', handler: (params: CapabilitiesEventParams) => void): void;
    once(
      request: 'capabilities',
      filter?: (event: CapabilitiesEventParams) => boolean,
    ): Promise<CapabilitiesEventParams>;

    /**
     * The event signals that a long running operation is about to start and provides additional information for the client to set up a corresponding progress and cancellation UI.
     * The client is free to delay the showing of the UI in order to reduce flicker.
     * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
     */
    on(request: 'progressStart', handler: (params: ProgressStartEventParams) => void): void;
    off(request: 'progressStart', handler: (params: ProgressStartEventParams) => void): void;
    once(
      request: 'progressStart',
      filter?: (event: ProgressStartEventParams) => boolean,
    ): Promise<ProgressStartEventParams>;

    /**
     * The event signals that the progress reporting needs to be updated with a new message and/or percentage.
     * The client does not have to update the UI immediately, but the clients needs to keep track of the message and/or percentage values.
     * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
     */
    on(request: 'progressUpdate', handler: (params: ProgressUpdateEventParams) => void): void;
    off(request: 'progressUpdate', handler: (params: ProgressUpdateEventParams) => void): void;
    once(
      request: 'progressUpdate',
      filter?: (event: ProgressUpdateEventParams) => boolean,
    ): Promise<ProgressUpdateEventParams>;

    /**
     * The event signals the end of the progress reporting with a final message.
     * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
     */
    on(request: 'progressEnd', handler: (params: ProgressEndEventParams) => void): void;
    off(request: 'progressEnd', handler: (params: ProgressEndEventParams) => void): void;
    once(
      request: 'progressEnd',
      filter?: (event: ProgressEndEventParams) => boolean,
    ): Promise<ProgressEndEventParams>;

    /**
     * This event signals that some state in the debug adapter has changed and requires that the client needs to re-render the data snapshot previously requested.
     * Debug adapters do not have to emit this event for runtime changes like stopped or thread events because in that case the client refetches the new state anyway. But the event can be used for example to refresh the UI after rendering formatting has changed in the debug adapter.
     * This event should only be sent if the corresponding capability `supportsInvalidatedEvent` is true.
     */
    on(request: 'invalidated', handler: (params: InvalidatedEventParams) => void): void;
    off(request: 'invalidated', handler: (params: InvalidatedEventParams) => void): void;
    once(
      request: 'invalidated',
      filter?: (event: InvalidatedEventParams) => boolean,
    ): Promise<InvalidatedEventParams>;

    /**
     * This event indicates that some memory range has been updated. It should only be sent if the corresponding capability `supportsMemoryEvent` is true.
     * Clients typically react to the event by re-issuing a `readMemory` request if they show the memory identified by the `memoryReference` and if the updated memory range overlaps the displayed range. Clients should not make assumptions how individual memory references relate to each other, so they should not assume that they are part of a single continuous address range and might overlap.
     * Debug adapters can use this event to indicate that the contents of a memory range has changed due to some other request like `setVariable` or `setExpression`. Debug adapters are not expected to emit this event for each and every memory change of a running program, because that information is typically not available from debuggers and it would flood clients with too many events.
     */
    on(request: 'memory', handler: (params: MemoryEventParams) => void): void;
    off(request: 'memory', handler: (params: MemoryEventParams) => void): void;
    once(
      request: 'memory',
      filter?: (event: MemoryEventParams) => boolean,
    ): Promise<MemoryEventParams>;

    /**
     * This request is sent from the debug adapter to the client to run a command in a terminal.
     * This is typically used to launch the debuggee in a terminal provided by the client.
     * This request should only be called if the corresponding client capability `supportsRunInTerminalRequest` is true.
     * Client implementations of `runInTerminal` are free to run the command however they choose including issuing the command to a command line interpreter (aka 'shell'). Argument strings passed to the `runInTerminal` request must arrive verbatim in the command to be run. As a consequence, clients which use a shell are responsible for escaping any special shell characters in the argument strings to prevent them from being interpreted (and modified) by the shell.
     * Some users may wish to take advantage of shell processing in the argument strings. For clients which implement `runInTerminal` using an intermediary shell, the `argsCanBeInterpretedByShell` property can be set to true. In this case the client is requested not to escape any special shell characters in the argument strings.
     */
    runInTerminal(params: RunInTerminalParams): Promise<RunInTerminalResult>;

    /**
     * This request is sent from the debug adapter to the client to start a new debug session of the same type as the caller.
     * This request should only be sent if the corresponding client capability `supportsStartDebuggingRequest` is true.
     * A client implementation of `startDebugging` should start a new debug session (of the same type as the caller) in the same way that the caller's session was started. If the client supports hierarchical debug sessions, the newly created session can be treated as a child of the caller session.
     */
    startDebugging(params: StartDebuggingParams): Promise<StartDebuggingResult>;

    /**
     * The `initialize` request is sent as the first request from the client to the debug adapter in order to configure it with client capabilities and to retrieve capabilities from the debug adapter.
     * Until the debug adapter has responded with an `initialize` response, the client must not send any additional requests or events to the debug adapter.
     * In addition the debug adapter is not allowed to send any requests or events to the client until it has responded with an `initialize` response.
     * The `initialize` request may only be sent once.
     */
    initialize(params: InitializeParams): Promise<InitializeResult>;

    /**
     * This request indicates that the client has finished initialization of the debug adapter.
     * So it is the last request in the sequence of configuration requests (which was started by the `initialized` event).
     * Clients should only call this request if the corresponding capability `supportsConfigurationDoneRequest` is true.
     */
    configurationDone(params: ConfigurationDoneParams): Promise<ConfigurationDoneResult>;

    /**
     * This launch request is sent from the client to the debug adapter to start the debuggee with or without debugging (if `noDebug` is true).
     * Since launching is debugger/runtime specific, the arguments for this request are not part of this specification.
     */
    launch(params: LaunchParams): Promise<LaunchResult>;

    /**
     * The `attach` request is sent from the client to the debug adapter to attach to a debuggee that is already running.
     * Since attaching is debugger/runtime specific, the arguments for this request are not part of this specification.
     */
    attach(params: AttachParams): Promise<AttachResult>;

    /**
     * Restarts a debug session. Clients should only call this request if the corresponding capability `supportsRestartRequest` is true.
     * If the capability is missing or has the value false, a typical client emulates `restart` by terminating the debug adapter first and then launching it anew.
     */
    restart(params: RestartParams): Promise<RestartResult>;

    /**
     * The `disconnect` request asks the debug adapter to disconnect from the debuggee (thus ending the debug session) and then to shut down itself (the debug adapter).
     * In addition, the debug adapter must terminate the debuggee if it was started with the `launch` request. If an `attach` request was used to connect to the debuggee, then the debug adapter must not terminate the debuggee.
     * This implicit behavior of when to terminate the debuggee can be overridden with the `terminateDebuggee` argument (which is only supported by a debug adapter if the corresponding capability `supportTerminateDebuggee` is true).
     */
    disconnect(params: DisconnectParams): Promise<DisconnectResult>;

    /**
     * The `terminate` request is sent from the client to the debug adapter in order to shut down the debuggee gracefully. Clients should only call this request if the capability `supportsTerminateRequest` is true.
     * Typically a debug adapter implements `terminate` by sending a software signal which the debuggee intercepts in order to clean things up properly before terminating itself.
     * Please note that this request does not directly affect the state of the debug session: if the debuggee decides to veto the graceful shutdown for any reason by not terminating itself, then the debug session just continues.
     * Clients can surface the `terminate` request as an explicit command or they can integrate it into a two stage Stop command that first sends `terminate` to request a graceful shutdown, and if that fails uses `disconnect` for a forceful shutdown.
     */
    terminate(params: TerminateParams): Promise<TerminateResult>;

    /**
     * The `breakpointLocations` request returns all possible locations for source breakpoints in a given range.
     * Clients should only call this request if the corresponding capability `supportsBreakpointLocationsRequest` is true.
     */
    breakpointLocations(params: BreakpointLocationsParams): Promise<BreakpointLocationsResult>;

    /**
     * Sets multiple breakpoints for a single source and clears all previous breakpoints in that source.
     * To clear all breakpoint for a source, specify an empty array.
     * When a breakpoint is hit, a `stopped` event (with reason `breakpoint`) is generated.
     */
    setBreakpoints(params: SetBreakpointsParams): Promise<SetBreakpointsResult>;

    /**
     * Replaces all existing function breakpoints with new function breakpoints.
     * To clear all function breakpoints, specify an empty array.
     * When a function breakpoint is hit, a `stopped` event (with reason `function breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsFunctionBreakpoints` is true.
     */
    setFunctionBreakpoints(
      params: SetFunctionBreakpointsParams,
    ): Promise<SetFunctionBreakpointsResult>;

    /**
     * The request configures the debugger's response to thrown exceptions.
     * If an exception is configured to break, a `stopped` event is fired (with reason `exception`).
     * Clients should only call this request if the corresponding capability `exceptionBreakpointFilters` returns one or more filters.
     */
    setExceptionBreakpoints(
      params: SetExceptionBreakpointsParams,
    ): Promise<SetExceptionBreakpointsResult>;

    /**
     * Obtains information on a possible data breakpoint that could be set on an expression or variable.
     * Clients should only call this request if the corresponding capability `supportsDataBreakpoints` is true.
     */
    dataBreakpointInfo(params: DataBreakpointInfoParams): Promise<DataBreakpointInfoResult>;

    /**
     * Replaces all existing data breakpoints with new data breakpoints.
     * To clear all data breakpoints, specify an empty array.
     * When a data breakpoint is hit, a `stopped` event (with reason `data breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsDataBreakpoints` is true.
     */
    setDataBreakpoints(params: SetDataBreakpointsParams): Promise<SetDataBreakpointsResult>;

    /**
     * Replaces all existing instruction breakpoints. Typically, instruction breakpoints would be set from a disassembly window.
     * To clear all instruction breakpoints, specify an empty array.
     * When an instruction breakpoint is hit, a `stopped` event (with reason `instruction breakpoint`) is generated.
     * Clients should only call this request if the corresponding capability `supportsInstructionBreakpoints` is true.
     */
    setInstructionBreakpoints(
      params: SetInstructionBreakpointsParams,
    ): Promise<SetInstructionBreakpointsResult>;

    /**
     * The request resumes execution of all threads. If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true resumes only the specified thread. If not all threads were resumed, the `allThreadsContinued` attribute of the response should be set to false.
     */
    continue(params: ContinueParams): Promise<ContinueResult>;

    /**
     * The request executes one step (in the given granularity) for the specified thread and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     */
    next(params: NextParams): Promise<NextResult>;

    /**
     * The request resumes the given thread to step into a function/method and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * If the request cannot step into a target, `stepIn` behaves like the `next` request.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     * If there are multiple function/method calls (or other targets) on the source line,
     * the argument `targetId` can be used to control into which target the `stepIn` should occur.
     * The list of possible targets for a given source line can be retrieved via the `stepInTargets` request.
     */
    stepIn(params: StepInParams): Promise<StepInResult>;

    /**
     * The request resumes the given thread to step out (return) from a function/method and allows all other threads to run freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     */
    stepOut(params: StepOutParams): Promise<StepOutResult>;

    /**
     * The request executes one backward step (in the given granularity) for the specified thread and allows all other threads to run backward freely by resuming them.
     * If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true prevents other suspended threads from resuming.
     * The debug adapter first sends the response and then a `stopped` event (with reason `step`) after the step has completed.
     * Clients should only call this request if the corresponding capability `supportsStepBack` is true.
     */
    stepBack(params: StepBackParams): Promise<StepBackResult>;

    /**
     * The request resumes backward execution of all threads. If the debug adapter supports single thread execution (see capability `supportsSingleThreadExecutionRequests`), setting the `singleThread` argument to true resumes only the specified thread. If not all threads were resumed, the `allThreadsContinued` attribute of the response should be set to false.
     * Clients should only call this request if the corresponding capability `supportsStepBack` is true.
     */
    reverseContinue(params: ReverseContinueParams): Promise<ReverseContinueResult>;

    /**
     * The request restarts execution of the specified stack frame.
     * The debug adapter first sends the response and then a `stopped` event (with reason `restart`) after the restart has completed.
     * Clients should only call this request if the corresponding capability `supportsRestartFrame` is true.
     */
    restartFrame(params: RestartFrameParams): Promise<RestartFrameResult>;

    /**
     * The request sets the location where the debuggee will continue to run.
     * This makes it possible to skip the execution of code or to execute code again.
     * The code between the current location and the goto target is not executed but skipped.
     * The debug adapter first sends the response and then a `stopped` event with reason `goto`.
     * Clients should only call this request if the corresponding capability `supportsGotoTargetsRequest` is true (because only then goto targets exist that can be passed as arguments).
     */
    goto(params: GotoParams): Promise<GotoResult>;

    /**
     * The request suspends the debuggee.
     * The debug adapter first sends the response and then a `stopped` event (with reason `pause`) after the thread has been paused successfully.
     */
    pause(params: PauseParams): Promise<PauseResult>;

    /**
     * The request returns a stacktrace from the current execution state of a given thread.
     * A client can request all stack frames by omitting the startFrame and levels arguments. For performance-conscious clients and if the corresponding capability `supportsDelayedStackTraceLoading` is true, stack frames can be retrieved in a piecemeal way with the `startFrame` and `levels` arguments. The response of the `stackTrace` request may contain a `totalFrames` property that hints at the total number of frames in the stack. If a client needs this total number upfront, it can issue a request for a single (first) frame and depending on the value of `totalFrames` decide how to proceed. In any case a client should be prepared to receive fewer frames than requested, which is an indication that the end of the stack has been reached.
     */
    stackTrace(params: StackTraceParams): Promise<StackTraceResult>;

    /**
     * The request returns the variable scopes for a given stack frame ID.
     */
    scopes(params: ScopesParams): Promise<ScopesResult>;

    /**
     * Retrieves all child variables for the given variable reference.
     * A filter can be used to limit the fetched children to either named or indexed children.
     */
    variables(params: VariablesParams): Promise<VariablesResult>;

    /**
     * Set the variable with the given name in the variable container to a new value. Clients should only call this request if the corresponding capability `supportsSetVariable` is true.
     * If a debug adapter implements both `setVariable` and `setExpression`, a client will only use `setExpression` if the variable has an `evaluateName` property.
     */
    setVariable(params: SetVariableParams): Promise<SetVariableResult>;

    /**
     * The request retrieves the source code for a given source reference.
     */
    source(params: SourceParams): Promise<SourceResult>;

    /**
     * The request retrieves a list of all threads.
     */
    threads(params: ThreadsParams): Promise<ThreadsResult>;

    /**
     * The request terminates the threads with the given ids.
     * Clients should only call this request if the corresponding capability `supportsTerminateThreadsRequest` is true.
     */
    terminateThreads(params: TerminateThreadsParams): Promise<TerminateThreadsResult>;

    /**
     * Modules can be retrieved from the debug adapter with this request which can either return all modules or a range of modules to support paging.
     * Clients should only call this request if the corresponding capability `supportsModulesRequest` is true.
     */
    modules(params: ModulesParams): Promise<ModulesResult>;

    /**
     * Retrieves the set of all sources currently loaded by the debugged process.
     * Clients should only call this request if the corresponding capability `supportsLoadedSourcesRequest` is true.
     */
    loadedSources(params: LoadedSourcesParams): Promise<LoadedSourcesResult>;

    /**
     * Evaluates the given expression in the context of the topmost stack frame.
     * The expression has access to any variables and arguments that are in scope.
     */
    evaluate(params: EvaluateParams): Promise<EvaluateResult>;

    /**
     * Evaluates the given `value` expression and assigns it to the `expression` which must be a modifiable l-value.
     * The expressions have access to any variables and arguments that are in scope of the specified frame.
     * Clients should only call this request if the corresponding capability `supportsSetExpression` is true.
     * If a debug adapter implements both `setExpression` and `setVariable`, a client uses `setExpression` if the variable has an `evaluateName` property.
     */
    setExpression(params: SetExpressionParams): Promise<SetExpressionResult>;

    /**
     * This request retrieves the possible step-in targets for the specified stack frame.
     * These targets can be used in the `stepIn` request.
     * Clients should only call this request if the corresponding capability `supportsStepInTargetsRequest` is true.
     */
    stepInTargets(params: StepInTargetsParams): Promise<StepInTargetsResult>;

    /**
     * This request retrieves the possible goto targets for the specified source location.
     * These targets can be used in the `goto` request.
     * Clients should only call this request if the corresponding capability `supportsGotoTargetsRequest` is true.
     */
    gotoTargets(params: GotoTargetsParams): Promise<GotoTargetsResult>;

    /**
     * Returns a list of possible completions for a given caret position and text.
     * Clients should only call this request if the corresponding capability `supportsCompletionsRequest` is true.
     */
    completions(params: CompletionsParams): Promise<CompletionsResult>;

    /**
     * Retrieves the details of the exception that caused this event to be raised.
     * Clients should only call this request if the corresponding capability `supportsExceptionInfoRequest` is true.
     */
    exceptionInfo(params: ExceptionInfoParams): Promise<ExceptionInfoResult>;

    /**
     * Reads bytes from memory at the provided location.
     * Clients should only call this request if the corresponding capability `supportsReadMemoryRequest` is true.
     */
    readMemory(params: ReadMemoryParams): Promise<ReadMemoryResult>;

    /**
     * Writes bytes to memory at the provided location.
     * Clients should only call this request if the corresponding capability `supportsWriteMemoryRequest` is true.
     */
    writeMemory(params: WriteMemoryParams): Promise<WriteMemoryResult>;

    /**
     * Disassembles code stored at the provided location.
     * Clients should only call this request if the corresponding capability `supportsDisassembleRequest` is true.
     */
    disassemble(params: DisassembleParams): Promise<DisassembleResult>;

    /**
     * Enable custom breakpoints.
     */
    enableCustomBreakpoints(
      params: EnableCustomBreakpointsParams,
    ): Promise<EnableCustomBreakpointsResult>;

    /**
     * Disable custom breakpoints.
     */
    disableCustomBreakpoints(
      params: DisableCustomBreakpointsParams,
    ): Promise<DisableCustomBreakpointsResult>;

    /**
     * Pretty prints source for debugging.
     */
    prettyPrintSource(params: PrettyPrintSourceParams): Promise<PrettyPrintSourceResult>;

    /**
     * Toggle skip status of file.
     */
    toggleSkipFileStatus(params: ToggleSkipFileStatusParams): Promise<ToggleSkipFileStatusResult>;

    /**
     * A request to reveal a certain location in the UI.
     */
    on(
      request: 'revealLocationRequested',
      handler: (params: RevealLocationRequestedEventParams) => void,
    ): void;
    off(
      request: 'revealLocationRequested',
      handler: (params: RevealLocationRequestedEventParams) => void,
    ): void;
    once(
      request: 'revealLocationRequested',
      filter?: (event: RevealLocationRequestedEventParams) => boolean,
    ): Promise<RevealLocationRequestedEventParams>;

    /**
     * A request to copy a certain string to clipboard.
     */
    on(request: 'copyRequested', handler: (params: CopyRequestedEventParams) => void): void;
    off(request: 'copyRequested', handler: (params: CopyRequestedEventParams) => void): void;
    once(
      request: 'copyRequested',
      filter?: (event: CopyRequestedEventParams) => boolean,
    ): Promise<CopyRequestedEventParams>;

    /**
     * An event sent when breakpoint prediction takes a significant amount of time.
     */
    on(request: 'longPrediction', handler: (params: LongPredictionEventParams) => void): void;
    off(request: 'longPrediction', handler: (params: LongPredictionEventParams) => void): void;
    once(
      request: 'longPrediction',
      filter?: (event: LongPredictionEventParams) => boolean,
    ): Promise<LongPredictionEventParams>;

    /**
     * Request to launch a browser in the companion extension within the UI.
     */
    on(
      request: 'launchBrowserInCompanion',
      handler: (params: LaunchBrowserInCompanionEventParams) => void,
    ): void;
    off(
      request: 'launchBrowserInCompanion',
      handler: (params: LaunchBrowserInCompanionEventParams) => void,
    ): void;
    once(
      request: 'launchBrowserInCompanion',
      filter?: (event: LaunchBrowserInCompanionEventParams) => boolean,
    ): Promise<LaunchBrowserInCompanionEventParams>;

    /**
     * Kills a launched browser companion.
     */
    on(
      request: 'killCompanionBrowser',
      handler: (params: KillCompanionBrowserEventParams) => void,
    ): void;
    off(
      request: 'killCompanionBrowser',
      handler: (params: KillCompanionBrowserEventParams) => void,
    ): void;
    once(
      request: 'killCompanionBrowser',
      filter?: (event: KillCompanionBrowserEventParams) => boolean,
    ): Promise<KillCompanionBrowserEventParams>;

    /**
     * Starts taking a profile of the target.
     */
    startProfile(params: StartProfileParams): Promise<StartProfileResult>;

    /**
     * Stops a running profile.
     */
    stopProfile(params: StopProfileParams): Promise<StopProfileResult>;

    /**
     * Fired when a profiling state changes.
     */
    on(request: 'profileStarted', handler: (params: ProfileStartedEventParams) => void): void;
    off(request: 'profileStarted', handler: (params: ProfileStartedEventParams) => void): void;
    once(
      request: 'profileStarted',
      filter?: (event: ProfileStartedEventParams) => boolean,
    ): Promise<ProfileStartedEventParams>;

    /**
     * Fired when a profiling state changes.
     */
    on(
      request: 'profilerStateUpdate',
      handler: (params: ProfilerStateUpdateEventParams) => void,
    ): void;
    off(
      request: 'profilerStateUpdate',
      handler: (params: ProfilerStateUpdateEventParams) => void,
    ): void;
    once(
      request: 'profilerStateUpdate',
      filter?: (event: ProfilerStateUpdateEventParams) => boolean,
    ): Promise<ProfilerStateUpdateEventParams>;

    /**
     * Launches a VS Code extension host in debug mode.
     */
    launchVSCode(params: LaunchVSCodeParams): Promise<LaunchVSCodeResult>;

    /**
     * Launches a VS Code extension host in debug mode.
     */
    launchUnelevated(params: LaunchUnelevatedParams): Promise<LaunchUnelevatedResult>;

    /**
     * Check if file exists on remote file system, used in VS.
     */
    remoteFileExists(params: RemoteFileExistsParams): Promise<RemoteFileExistsResult>;

    /**
     * Focuses the browser page or tab associated with the session.
     */
    revealPage(params: RevealPageParams): Promise<RevealPageResult>;

    /**
     * Starts profiling the extension itself. Used by VS.
     */
    startSelfProfile(params: StartSelfProfileParams): Promise<StartSelfProfileResult>;

    /**
     * Stops profiling the extension itself. Used by VS.
     */
    stopSelfProfile(params: StopSelfProfileParams): Promise<StopSelfProfileResult>;

    /**
     * Requests that we get performance information from the runtime.
     */
    getPerformance(params: GetPerformanceParams): Promise<GetPerformanceResult>;

    /**
     * Fired when requesting a missing source from a sourcemap. UI will offer to disable the sourcemap.
     */
    on(
      request: 'suggestDisableSourcemap',
      handler: (params: SuggestDisableSourcemapEventParams) => void,
    ): void;
    off(
      request: 'suggestDisableSourcemap',
      handler: (params: SuggestDisableSourcemapEventParams) => void,
    ): void;
    once(
      request: 'suggestDisableSourcemap',
      filter?: (event: SuggestDisableSourcemapEventParams) => boolean,
    ): Promise<SuggestDisableSourcemapEventParams>;

    /**
     * Disables the sourcemapped source and refreshes the stacktrace if paused.
     */
    disableSourcemap(params: DisableSourcemapParams): Promise<DisableSourcemapResult>;

    /**
     * Generates diagnostic information for the debug session.
     */
    createDiagnostics(params: CreateDiagnosticsParams): Promise<CreateDiagnosticsResult>;

    /**
     * Saves recent diagnostic logs for the debug session.
     */
    saveDiagnosticLogs(params: SaveDiagnosticLogsParams): Promise<SaveDiagnosticLogsResult>;

    /**
     * Shows a prompt to the user suggesting they use the diagnostic tool if breakpoints don't bind.
     */
    on(
      request: 'suggestDiagnosticTool',
      handler: (params: SuggestDiagnosticToolEventParams) => void,
    ): void;
    off(
      request: 'suggestDiagnosticTool',
      handler: (params: SuggestDiagnosticToolEventParams) => void,
    ): void;
    once(
      request: 'suggestDiagnosticTool',
      filter?: (event: SuggestDiagnosticToolEventParams) => boolean,
    ): Promise<SuggestDiagnosticToolEventParams>;

    /**
     * Opens the diagnostic tool if breakpoints don't bind.
     */
    on(
      request: 'openDiagnosticTool',
      handler: (params: OpenDiagnosticToolEventParams) => void,
    ): void;
    off(
      request: 'openDiagnosticTool',
      handler: (params: OpenDiagnosticToolEventParams) => void,
    ): void;
    once(
      request: 'openDiagnosticTool',
      filter?: (event: OpenDiagnosticToolEventParams) => boolean,
    ): Promise<OpenDiagnosticToolEventParams>;

    /**
     * Request WebSocket connection information on a proxy for this debug sessions CDP connection.
     */
    requestCDPProxy(params: RequestCDPProxyParams): Promise<RequestCDPProxyResult>;

    /**
     * Adds an excluded caller/target pair.
     */
    setExcludedCallers(params: SetExcludedCallersParams): Promise<SetExcludedCallersResult>;

    /**
     * Configures whether source map stepping is enabled.
     */
    setSourceMapStepping(params: SetSourceMapSteppingParams): Promise<SetSourceMapSteppingResult>;

    /**
     * Sets debugger properties.
     */
    setDebuggerProperty(params: SetDebuggerPropertyParams): Promise<SetDebuggerPropertyResult>;

    /**
     * The event indicates that one or more capabilities have changed.
     */
    capabilitiesExtended(params: CapabilitiesExtendedParams): Promise<CapabilitiesExtendedResult>;

    /**
     * Used by evaluate and variables.
     */
    evaluationOptions(params: EvaluationOptionsParams): Promise<EvaluationOptionsResult>;

    /**
     * Sets options for locating symbols.
     */
    setSymbolOptions(params: SetSymbolOptionsParams): Promise<SetSymbolOptionsResult>;
  }

  export interface AttachParams {
    /**
     * Arbitrary data from the previous, restarted session.
     * The data is sent as the `restart` attribute of the `terminated` event.
     * The client should leave the data intact.
     */
    __restart?: any[] | boolean | integer | null | number | object | string;
  }

  export interface AttachResult {}

  export interface BreakpointEventParams {
    /**
     * The reason for the event.
     */
    reason: 'changed' | 'new' | 'removed';

    /**
     * The `id` attribute is used to find the target breakpoint, the other attributes are used as the new values.
     */
    breakpoint: Breakpoint;
  }

  export interface BreakpointLocationsParams {
    /**
     * The source location of the breakpoints; either `source.path` or `source.reference` must be specified.
     */
    source: Source;

    /**
     * Start line of range to search possible breakpoint locations in. If only the line is specified, the request returns all possible locations in that line.
     */
    line: integer;

    /**
     * Start position within `line` to search possible breakpoint locations in. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based. If no column is given, the first position in the start line is assumed.
     */
    column?: integer;

    /**
     * End line of range to search possible breakpoint locations in. If no end line is given, then the end line is assumed to be the start line.
     */
    endLine?: integer;

    /**
     * End position within `endLine` to search possible breakpoint locations in. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based. If no end column is given, the last position in the end line is assumed.
     */
    endColumn?: integer;
  }

  export interface BreakpointLocationsResult {
    /**
     * Sorted set of possible breakpoint locations.
     */
    breakpoints: BreakpointLocation[];
  }

  export interface CancelParams {
    /**
     * The ID (attribute `seq`) of the request to cancel. If missing no request is cancelled.
     * Both a `requestId` and a `progressId` can be specified in one request.
     */
    requestId?: integer;

    /**
     * The ID (attribute `progressId`) of the progress to cancel. If missing no progress is cancelled.
     * Both a `requestId` and a `progressId` can be specified in one request.
     */
    progressId?: string;
  }

  export interface CancelResult {}

  export interface CapabilitiesEventParams {
    /**
     * The set of updated capabilities.
     */
    capabilities: Capabilities;
  }

  export interface CapabilitiesExtendedParams {
    params: CapabilitiesExtended;
  }

  export interface CapabilitiesExtendedResult {}

  export interface CompletionsParams {
    /**
     * Returns completions in the scope of this stack frame. If not specified, the completions are returned for the global scope.
     */
    frameId?: integer;

    /**
     * One or more source lines. Typically this is the text users have typed into the debug console before they asked for completion.
     */
    text: string;

    /**
     * The position within `text` for which to determine the completion proposals. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column: integer;

    /**
     * A line for which to determine the completion proposals. If missing the first line of the text is assumed.
     */
    line?: integer;
  }

  export interface CompletionsResult {
    /**
     * The possible completions for .
     */
    targets: CompletionItem[];
  }

  export interface ConfigurationDoneParams {}

  export interface ConfigurationDoneResult {}

  export interface ContinueParams {
    /**
     * Specifies the active thread. If the debug adapter supports single thread execution (see `supportsSingleThreadExecutionRequests`) and the argument `singleThread` is true, only the thread with this ID is resumed.
     */
    threadId: integer;

    /**
     * If this flag is true, execution is resumed only for the thread with given `threadId`.
     */
    singleThread?: boolean;
  }

  export interface ContinueResult {
    /**
     * The value true (or a missing property) signals to the client that all threads have been resumed. The value false indicates that not all threads were resumed.
     */
    allThreadsContinued?: boolean;
  }

  export interface ContinuedEventParams {
    /**
     * The thread which was continued.
     */
    threadId: integer;

    /**
     * If `allThreadsContinued` is true, a debug adapter can announce that all threads have continued.
     */
    allThreadsContinued?: boolean;
  }

  export interface CopyRequestedEventParams {
    /**
     * Text to copy.
     */
    text: string;
  }

  export interface CreateDiagnosticsParams {
    /**
     * Whether the tool is opening from a prompt
     */
    fromSuggestion?: boolean;
  }

  export interface CreateDiagnosticsResult {
    /**
     * Location of the generated report on disk
     */
    file: string;
  }

  export interface DataBreakpointInfoParams {
    /**
     * Reference to the variable container if the data breakpoint is requested for a child of the container. The `variablesReference` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference?: integer;

    /**
     * The name of the variable's child to obtain data breakpoint information for.
     * If `variablesReference` isn't specified, this can be an expression.
     */
    name: string;

    /**
     * When `name` is an expression, evaluate it in the scope of this stack frame. If not specified, the expression is evaluated in the global scope. When `variablesReference` is specified, this property has no effect.
     */
    frameId?: integer;
  }

  export interface DataBreakpointInfoResult {
    /**
     * An identifier for the data on which a data breakpoint can be registered with the `setDataBreakpoints` request or null if no data breakpoint is available.
     */
    dataId: string | null;

    /**
     * UI string that describes on what data the breakpoint is set on or why a data breakpoint is not available.
     */
    description: string;

    /**
     * Attribute lists the available access types for a potential data breakpoint. A UI client could surface this information.
     */
    accessTypes?: DataBreakpointAccessType[];

    /**
     * Attribute indicates that a potential data breakpoint could be persisted across sessions.
     */
    canPersist?: boolean;
  }

  export interface DisableCustomBreakpointsParams {
    /**
     * Id of breakpoints to enable.
     */
    ids: string[];
  }

  export interface DisableCustomBreakpointsResult {}

  export interface DisableSourcemapParams {
    /**
     * Source to be pretty printed.
     */
    source: Source;
  }

  export interface DisableSourcemapResult {}

  export interface DisassembleParams {
    /**
     * Memory reference to the base location containing the instructions to disassemble.
     */
    memoryReference: string;

    /**
     * Offset (in bytes) to be applied to the reference location before disassembling. Can be negative.
     */
    offset?: integer;

    /**
     * Offset (in instructions) to be applied after the byte offset (if any) before disassembling. Can be negative.
     */
    instructionOffset?: integer;

    /**
     * Number of instructions to disassemble starting at the specified location and offset.
     * An adapter must return exactly this number of instructions - any unavailable instructions should be replaced with an implementation-defined 'invalid instruction' value.
     */
    instructionCount: integer;

    /**
     * If true, the adapter should attempt to resolve memory addresses and other values to symbolic names.
     */
    resolveSymbols?: boolean;
  }

  export interface DisassembleResult {
    /**
     * The list of disassembled instructions.
     */
    instructions: DisassembledInstruction[];
  }

  export interface DisconnectParams {
    /**
     * A value of true indicates that this `disconnect` request is part of a restart sequence.
     */
    restart?: boolean;

    /**
     * Indicates whether the debuggee should be terminated when the debugger is disconnected.
     * If unspecified, the debug adapter is free to do whatever it thinks is best.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportTerminateDebuggee` is true.
     */
    terminateDebuggee?: boolean;

    /**
     * Indicates whether the debuggee should stay suspended when the debugger is disconnected.
     * If unspecified, the debuggee should resume execution.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportSuspendDebuggee` is true.
     */
    suspendDebuggee?: boolean;
  }

  export interface DisconnectResult {}

  export interface EnableCustomBreakpointsParams {
    /**
     * Id of breakpoints to enable.
     */
    ids: string[];
  }

  export interface EnableCustomBreakpointsResult {}

  export interface EvaluateParams {
    /**
     * The expression to evaluate.
     */
    expression: string;

    /**
     * Evaluate the expression in the scope of this stack frame. If not specified, the expression is evaluated in the global scope.
     */
    frameId?: integer;

    /**
     * The context in which the evaluate request is used.
     */
    context?: 'watch' | 'repl' | 'hover' | 'clipboard' | 'variables';

    /**
     * Specifies details on how to format the result.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsValueFormattingOptions` is true.
     */
    format?: ValueFormat;
  }

  export interface EvaluateResult {
    /**
     * The result of the evaluate request.
     */
    result: string;

    /**
     * The type of the evaluate result.
     * This attribute should only be returned by a debug adapter if the corresponding capability `supportsVariableType` is true.
     */
    type?: string;

    /**
     * Properties of an evaluate result that can be used to determine how to render the result in the UI.
     */
    presentationHint?: VariablePresentationHint;

    /**
     * If `variablesReference` is > 0, the evaluate result is structured and its children can be retrieved by passing `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference: integer;

    /**
     * The number of named child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    namedVariables?: integer;

    /**
     * The number of indexed child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    indexedVariables?: integer;

    /**
     * A memory reference to a location appropriate for this result.
     * For pointer type eval results, this is generally a reference to the memory address contained in the pointer.
     * This attribute should be returned by a debug adapter if corresponding capability `supportsMemoryReferences` is true.
     */
    memoryReference?: string;
  }

  export interface EvaluationOptionsParams {
    evaluateParams?: EvaluateParamsExtended;

    variablesParams?: VariablesParamsExtended;

    stackTraceParams?: StackTraceParamsExtended;
  }

  export interface EvaluationOptionsResult {}

  export interface ExceptionInfoParams {
    /**
     * Thread for which exception information should be retrieved.
     */
    threadId: integer;
  }

  export interface ExceptionInfoResult {
    /**
     * ID of the exception that was thrown.
     */
    exceptionId: string;

    /**
     * Descriptive text for the exception.
     */
    description?: string;

    /**
     * Mode that caused the exception notification to be raised.
     */
    breakMode: ExceptionBreakMode;

    /**
     * Detailed information about the exception.
     */
    details?: ExceptionDetails;
  }

  export interface ExitedEventParams {
    /**
     * The exit code returned from the debuggee.
     */
    exitCode: integer;
  }

  export interface GetPerformanceParams {}

  export interface GetPerformanceResult {
    /**
     * Response to 'GetPerformance' request. A key-value list of runtime-dependent details.
     */
    metrics?: object;

    /**
     * Optional error from the adapter
     */
    error?: string;
  }

  export interface GotoParams {
    /**
     * Set the goto target for this thread.
     */
    threadId: integer;

    /**
     * The location where the debuggee will continue to run.
     */
    targetId: integer;
  }

  export interface GotoResult {}

  export interface GotoTargetsParams {
    /**
     * The source location for which the goto targets are determined.
     */
    source: Source;

    /**
     * The line location for which the goto targets are determined.
     */
    line: integer;

    /**
     * The position within `line` for which the goto targets are determined. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: integer;
  }

  export interface GotoTargetsResult {
    /**
     * The possible goto targets of the specified location.
     */
    targets: GotoTarget[];
  }

  export interface InitializeParams {
    /**
     * The ID of the client using this adapter.
     */
    clientID?: string;

    /**
     * The human-readable name of the client using this adapter.
     */
    clientName?: string;

    /**
     * The ID of the debug adapter.
     */
    adapterID: string;

    /**
     * The ISO-639 locale of the client using this adapter, e.g. en-US or de-CH.
     */
    locale?: string;

    /**
     * If true all line numbers are 1-based (default).
     */
    linesStartAt1?: boolean;

    /**
     * If true all column numbers are 1-based (default).
     */
    columnsStartAt1?: boolean;

    /**
     * Determines in what format paths are specified. The default is `path`, which is the native format.
     */
    pathFormat?: 'path' | 'uri';

    /**
     * Client supports the `type` attribute for variables.
     */
    supportsVariableType?: boolean;

    /**
     * Client supports the paging of variables.
     */
    supportsVariablePaging?: boolean;

    /**
     * Client supports the `runInTerminal` request.
     */
    supportsRunInTerminalRequest?: boolean;

    /**
     * Client supports memory references.
     */
    supportsMemoryReferences?: boolean;

    /**
     * Client supports progress reporting.
     */
    supportsProgressReporting?: boolean;

    /**
     * Client supports the `invalidated` event.
     */
    supportsInvalidatedEvent?: boolean;

    /**
     * Client supports the `memory` event.
     */
    supportsMemoryEvent?: boolean;

    /**
     * Client supports the `argsCanBeInterpretedByShell` attribute on the `runInTerminal` request.
     */
    supportsArgsCanBeInterpretedByShell?: boolean;

    /**
     * Client supports the `startDebugging` request.
     */
    supportsStartDebuggingRequest?: boolean;
  }

  export interface InitializeResult {
    /**
     * The debug adapter supports the `configurationDone` request.
     */
    supportsConfigurationDoneRequest?: boolean;

    /**
     * The debug adapter supports function breakpoints.
     */
    supportsFunctionBreakpoints?: boolean;

    /**
     * The debug adapter supports conditional breakpoints.
     */
    supportsConditionalBreakpoints?: boolean;

    /**
     * The debug adapter supports breakpoints that break execution after a specified number of hits.
     */
    supportsHitConditionalBreakpoints?: boolean;

    /**
     * The debug adapter supports a (side effect free) `evaluate` request for data hovers.
     */
    supportsEvaluateForHovers?: boolean;

    /**
     * Available exception filter options for the `setExceptionBreakpoints` request.
     */
    exceptionBreakpointFilters?: ExceptionBreakpointsFilter[];

    /**
     * The debug adapter supports stepping back via the `stepBack` and `reverseContinue` requests.
     */
    supportsStepBack?: boolean;

    /**
     * The debug adapter supports setting a variable to a value.
     */
    supportsSetVariable?: boolean;

    /**
     * The debug adapter supports restarting a frame.
     */
    supportsRestartFrame?: boolean;

    /**
     * The debug adapter supports the `gotoTargets` request.
     */
    supportsGotoTargetsRequest?: boolean;

    /**
     * The debug adapter supports the `stepInTargets` request.
     */
    supportsStepInTargetsRequest?: boolean;

    /**
     * The debug adapter supports the `completions` request.
     */
    supportsCompletionsRequest?: boolean;

    /**
     * The set of characters that should trigger completion in a REPL. If not specified, the UI should assume the `.` character.
     */
    completionTriggerCharacters?: string[];

    /**
     * The debug adapter supports the `modules` request.
     */
    supportsModulesRequest?: boolean;

    /**
     * The set of additional module information exposed by the debug adapter.
     */
    additionalModuleColumns?: ColumnDescriptor[];

    /**
     * Checksum algorithms supported by the debug adapter.
     */
    supportedChecksumAlgorithms?: ChecksumAlgorithm[];

    /**
     * The debug adapter supports the `restart` request. In this case a client should not implement `restart` by terminating and relaunching the adapter but by calling the `restart` request.
     */
    supportsRestartRequest?: boolean;

    /**
     * The debug adapter supports `exceptionOptions` on the `setExceptionBreakpoints` request.
     */
    supportsExceptionOptions?: boolean;

    /**
     * The debug adapter supports a `format` attribute on the `stackTrace`, `variables`, and `evaluate` requests.
     */
    supportsValueFormattingOptions?: boolean;

    /**
     * The debug adapter supports the `exceptionInfo` request.
     */
    supportsExceptionInfoRequest?: boolean;

    /**
     * The debug adapter supports the `terminateDebuggee` attribute on the `disconnect` request.
     */
    supportTerminateDebuggee?: boolean;

    /**
     * The debug adapter supports the `suspendDebuggee` attribute on the `disconnect` request.
     */
    supportSuspendDebuggee?: boolean;

    /**
     * The debug adapter supports the delayed loading of parts of the stack, which requires that both the `startFrame` and `levels` arguments and the `totalFrames` result of the `stackTrace` request are supported.
     */
    supportsDelayedStackTraceLoading?: boolean;

    /**
     * The debug adapter supports the `loadedSources` request.
     */
    supportsLoadedSourcesRequest?: boolean;

    /**
     * The debug adapter supports log points by interpreting the `logMessage` attribute of the `SourceBreakpoint`.
     */
    supportsLogPoints?: boolean;

    /**
     * The debug adapter supports the `terminateThreads` request.
     */
    supportsTerminateThreadsRequest?: boolean;

    /**
     * The debug adapter supports the `setExpression` request.
     */
    supportsSetExpression?: boolean;

    /**
     * The debug adapter supports the `terminate` request.
     */
    supportsTerminateRequest?: boolean;

    /**
     * The debug adapter supports data breakpoints.
     */
    supportsDataBreakpoints?: boolean;

    /**
     * The debug adapter supports the `readMemory` request.
     */
    supportsReadMemoryRequest?: boolean;

    /**
     * The debug adapter supports the `writeMemory` request.
     */
    supportsWriteMemoryRequest?: boolean;

    /**
     * The debug adapter supports the `disassemble` request.
     */
    supportsDisassembleRequest?: boolean;

    /**
     * The debug adapter supports the `cancel` request.
     */
    supportsCancelRequest?: boolean;

    /**
     * The debug adapter supports the `breakpointLocations` request.
     */
    supportsBreakpointLocationsRequest?: boolean;

    /**
     * The debug adapter supports the `clipboard` context value in the `evaluate` request.
     */
    supportsClipboardContext?: boolean;

    /**
     * The debug adapter supports stepping granularities (argument `granularity`) for the stepping requests.
     */
    supportsSteppingGranularity?: boolean;

    /**
     * The debug adapter supports adding breakpoints based on instruction references.
     */
    supportsInstructionBreakpoints?: boolean;

    /**
     * The debug adapter supports `filterOptions` as an argument on the `setExceptionBreakpoints` request.
     */
    supportsExceptionFilterOptions?: boolean;

    /**
     * The debug adapter supports the `singleThread` property on the execution requests (`continue`, `next`, `stepIn`, `stepOut`, `reverseContinue`, `stepBack`).
     */
    supportsSingleThreadExecutionRequests?: boolean;
  }

  export interface InitializedEventParams {}

  export interface InvalidatedEventParams {
    /**
     * Set of logical areas that got invalidated. This property has a hint characteristic: a client can only be expected to make a 'best effort' in honoring the areas but there are no guarantees. If this property is missing, empty, or if values are not understood, the client should assume a single value `all`.
     */
    areas?: InvalidatedAreas[];

    /**
     * If specified, the client only needs to refetch data related to this thread.
     */
    threadId?: integer;

    /**
     * If specified, the client only needs to refetch data related to this stack frame (and the `threadId` is ignored).
     */
    stackFrameId?: integer;
  }

  export interface KillCompanionBrowserEventParams {
    /**
     * Incrementing ID to refer to this browser launch request
     */
    launchId: number;
  }

  export interface LaunchBrowserInCompanionEventParams {
    /**
     * Type of browser to launch
     */
    type: string;

    /**
     * Incrementing ID to refer to this browser launch request
     */
    launchId: number;

    /**
     * Local port the debug server is listening on
     */
    serverPort: number;

    /**
     * Server path to connect to
     */
    path?: string;

    browserArgs?: string[];

    attach?: object;

    /**
     * Original launch parameters for the debug session
     */
    params: object;
  }

  export interface LaunchParams {
    /**
     * If true, the launch request should launch the program without enabling debugging.
     */
    noDebug?: boolean;

    /**
     * Arbitrary data from the previous, restarted session.
     * The data is sent as the `restart` attribute of the `terminated` event.
     * The client should leave the data intact.
     */
    __restart?: any[] | boolean | integer | null | number | object | string;
  }

  export interface LaunchResult {}

  export interface LaunchUnelevatedParams {
    process?: string;

    args?: string[];
  }

  export interface LaunchUnelevatedResult {}

  export interface LaunchVSCodeParams {
    args: LaunchVSCodeArgument[];

    env: object;

    debugRenderer?: boolean;
  }

  export interface LaunchVSCodeResult {
    rendererDebugPort?: number;
  }

  export interface LoadedSourceEventParams {
    /**
     * The reason for the event.
     */
    reason: string;

    /**
     * The new, changed, or removed source.
     */
    source: Source;
  }

  export interface LoadedSourcesParams {}

  export interface LoadedSourcesResult {
    /**
     * Set of loaded sources.
     */
    sources: Source[];
  }

  export interface LongPredictionEventParams {}

  export interface MemoryEventParams {
    /**
     * Memory reference of a memory range that has been updated.
     */
    memoryReference: string;

    /**
     * Starting offset in bytes where memory has been updated. Can be negative.
     */
    offset: integer;

    /**
     * Number of bytes updated.
     */
    count: integer;
  }

  export interface ModuleEventParams {
    /**
     * The reason for the event.
     */
    reason: string;

    /**
     * The new, changed, or removed module. In case of `removed` only the module id is used.
     */
    module: Module;
  }

  export interface ModulesParams {
    /**
     * The index of the first module to return; if omitted modules start at 0.
     */
    startModule?: integer;

    /**
     * The number of modules to return. If `moduleCount` is not specified or 0, all modules are returned.
     */
    moduleCount?: integer;
  }

  export interface ModulesResult {
    /**
     * All modules or range of modules.
     */
    modules: Module[];

    /**
     * The total number of modules available.
     */
    totalModules?: integer;
  }

  export interface NextParams {
    /**
     * Specifies the thread for which to resume execution for one step (of the given granularity).
     */
    threadId: integer;

    /**
     * If this flag is true, all other suspended threads are not resumed.
     */
    singleThread?: boolean;

    /**
     * Stepping granularity. If no granularity is specified, a granularity of `statement` is assumed.
     */
    granularity?: SteppingGranularity;
  }

  export interface NextResult {}

  export interface OpenDiagnosticToolEventParams {
    /**
     * Location of the generated report on disk
     */
    file: string;
  }

  export interface OutputEventParams {
    /**
     * The output category. If not specified or if the category is not understood by the client, `console` is assumed.
     */
    category?: 'console' | 'important' | 'stdout' | 'stderr' | 'telemetry';

    /**
     * The output to report.
     */
    output: string;

    /**
     * Support for keeping an output log organized by grouping related messages.
     */
    group?: string;

    /**
     * If an attribute `variablesReference` exists and its value is > 0, the output contains objects which can be retrieved by passing `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference?: integer;

    /**
     * The source location where the output was produced.
     */
    source?: Source;

    /**
     * The source location's line where the output was produced.
     */
    line?: integer;

    /**
     * The position in `line` where the output was produced. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: integer;

    /**
     * Additional data to report. For the `telemetry` category the data is sent to telemetry, for the other categories the data is shown in JSON format.
     */
    data?: any[] | boolean | integer | null | number | object | string;
  }

  export interface PauseParams {
    /**
     * Pause execution for this thread.
     */
    threadId: integer;
  }

  export interface PauseResult {}

  export interface PrettyPrintSourceParams {
    /**
     * Source to be pretty printed.
     */
    source: Source;

    /**
     * Line number of currently selected location to reveal after pretty printing. If not present, nothing is revealed.
     */
    line?: integer;

    /**
     * Column number of currently selected location to reveal after pretty printing.
     */
    column?: integer;
  }

  export interface PrettyPrintSourceResult {}

  export interface ProcessEventParams {
    /**
     * The logical name of the process. This is usually the full path to process's executable file. Example: /home/example/myproj/program.js.
     */
    name: string;

    /**
     * The system process id of the debugged process. This property is missing for non-system processes.
     */
    systemProcessId?: integer;

    /**
     * If true, the process is running on the same computer as the debug adapter.
     */
    isLocalProcess?: boolean;

    /**
     * Describes how the debug engine started debugging this process.
     */
    startMethod?: string;

    /**
     * The size of a pointer or address for this process, in bits. This value may be used by clients when formatting addresses for display.
     */
    pointerSize?: integer;
  }

  export interface ProfileStartedEventParams {
    /**
     * Type of running profile
     */
    type: string;

    /**
     * Location where the profile is saved.
     */
    file: string;
  }

  export interface ProfilerStateUpdateEventParams {
    /**
     * Description of the current state
     */
    label: string;

    /**
     * Set to false if the profile has now ended
     */
    running: boolean;
  }

  export interface ProgressEndEventParams {
    /**
     * The ID that was introduced in the initial `ProgressStartEvent`.
     */
    progressId: string;

    /**
     * More detailed progress message. If omitted, the previous message (if any) is used.
     */
    message?: string;
  }

  export interface ProgressStartEventParams {
    /**
     * An ID that can be used in subsequent `progressUpdate` and `progressEnd` events to make them refer to the same progress reporting.
     * IDs must be unique within a debug session.
     */
    progressId: string;

    /**
     * Short title of the progress reporting. Shown in the UI to describe the long running operation.
     */
    title: string;

    /**
     * The request ID that this progress report is related to. If specified a debug adapter is expected to emit progress events for the long running request until the request has been either completed or cancelled.
     * If the request ID is omitted, the progress report is assumed to be related to some general activity of the debug adapter.
     */
    requestId?: integer;

    /**
     * If true, the request that reports progress may be cancelled with a `cancel` request.
     * So this property basically controls whether the client should use UX that supports cancellation.
     * Clients that don't support cancellation are allowed to ignore the setting.
     */
    cancellable?: boolean;

    /**
     * More detailed progress message.
     */
    message?: string;

    /**
     * Progress percentage to display (value range: 0 to 100). If omitted no percentage is shown.
     */
    percentage?: number;
  }

  export interface ProgressUpdateEventParams {
    /**
     * The ID that was introduced in the initial `progressStart` event.
     */
    progressId: string;

    /**
     * More detailed progress message. If omitted, the previous message (if any) is used.
     */
    message?: string;

    /**
     * Progress percentage to display (value range: 0 to 100). If omitted no percentage is shown.
     */
    percentage?: number;
  }

  export interface ReadMemoryParams {
    /**
     * Memory reference to the base location from which data should be read.
     */
    memoryReference: string;

    /**
     * Offset (in bytes) to be applied to the reference location before reading data. Can be negative.
     */
    offset?: integer;

    /**
     * Number of bytes to read at the specified location and offset.
     */
    count: integer;
  }

  export interface ReadMemoryResult {
    /**
     * The address of the first byte of data returned.
     * Treated as a hex value if prefixed with `0x`, or as a decimal value otherwise.
     */
    address: string;

    /**
     * The number of unreadable bytes encountered after the last successfully read byte.
     * This can be used to determine the number of bytes that should be skipped before a subsequent `readMemory` request succeeds.
     */
    unreadableBytes?: integer;

    /**
     * The bytes read from memory, encoded using base64. If the decoded length of `data` is less than the requested `count` in the original `readMemory` request, and `unreadableBytes` is zero or omitted, then the client should assume it's reached the end of readable memory.
     */
    data?: string;
  }

  export interface RemoteFileExistsParams {
    localFilePath?: string;
  }

  export interface RemoteFileExistsResult {
    /**
     * Does the file exist on the remote file system.
     */
    doesExists: boolean;
  }

  export interface RequestCDPProxyParams {}

  export interface RequestCDPProxyResult {
    /**
     * Name of the host, on which the CDP proxy is available through a WebSocket.
     */
    host: string;

    /**
     * Port on the host, under which the CDP proxy is available through a WebSocket.
     */
    port: number;

    /**
     * Websocket path to connect to.
     */
    path: string;
  }

  export interface RestartFrameParams {
    /**
     * Restart the stack frame identified by `frameId`. The `frameId` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    frameId: integer;
  }

  export interface RestartFrameResult {}

  export interface RestartParams {
    /**
     * The latest version of the `launch` or `attach` configuration.
     */
    arguments?: LaunchRequestArguments | AttachRequestArguments;
  }

  export interface RestartResult {}

  export interface RevealLocationRequestedEventParams {
    /**
     * The source to reveal.
     */
    source: Source;

    /**
     * The line number to reveal.
     */
    line?: integer;

    /**
     * The column number to reveal.
     */
    column?: integer;
  }

  export interface RevealPageParams {}

  export interface RevealPageResult {}

  export interface ReverseContinueParams {
    /**
     * Specifies the active thread. If the debug adapter supports single thread execution (see `supportsSingleThreadExecutionRequests`) and the `singleThread` argument is true, only the thread with this ID is resumed.
     */
    threadId: integer;

    /**
     * If this flag is true, backward execution is resumed only for the thread with given `threadId`.
     */
    singleThread?: boolean;
  }

  export interface ReverseContinueResult {}

  export interface RunInTerminalParams {
    /**
     * What kind of terminal to launch. Defaults to `integrated` if not specified.
     */
    kind?: string;

    /**
     * Title of the terminal.
     */
    title?: string;

    /**
     * Working directory for the command. For non-empty, valid paths this typically results in execution of a change directory command.
     */
    cwd: string;

    /**
     * List of arguments. The first argument is the command to run.
     */
    args: string[];

    /**
     * Environment key-value pairs that are added to or removed from the default environment.
     */
    env?: object;

    /**
     * This property should only be set if the corresponding capability `supportsArgsCanBeInterpretedByShell` is true. If the client uses an intermediary shell to launch the application, then the client must not attempt to escape characters with special meanings for the shell. The user is fully responsible for escaping as needed and that arguments using special characters may not be portable across shells.
     */
    argsCanBeInterpretedByShell?: boolean;
  }

  export interface RunInTerminalResult {
    /**
     * The process ID. The value should be less than or equal to 2147483647 (2^31-1).
     */
    processId?: integer;

    /**
     * The process ID of the terminal shell. The value should be less than or equal to 2147483647 (2^31-1).
     */
    shellProcessId?: integer;
  }

  export interface SaveDiagnosticLogsParams {
    /**
     * File where logs should be saved
     */
    toFile: string;
  }

  export interface SaveDiagnosticLogsResult {}

  export interface ScopesParams {
    /**
     * Retrieve the scopes for the stack frame identified by `frameId`. The `frameId` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    frameId: integer;
  }

  export interface ScopesResult {
    /**
     * The scopes of the stack frame. If the array has length zero, there are no scopes available.
     */
    scopes: Scope[];
  }

  export interface SetBreakpointsParams {
    /**
     * The source location of the breakpoints; either `source.path` or `source.sourceReference` must be specified.
     */
    source: Source;

    /**
     * The code locations of the breakpoints.
     */
    breakpoints?: SourceBreakpoint[];

    /**
     * Deprecated: The code locations of the breakpoints.
     */
    lines?: integer[];

    /**
     * A value of true indicates that the underlying source has been modified which results in new breakpoint locations.
     */
    sourceModified?: boolean;
  }

  export interface SetBreakpointsResult {
    /**
     * Information about the breakpoints.
     * The array elements are in the same order as the elements of the `breakpoints` (or the deprecated `lines`) array in the arguments.
     */
    breakpoints: Breakpoint[];
  }

  export interface SetDataBreakpointsParams {
    /**
     * The contents of this array replaces all existing data breakpoints. An empty array clears all data breakpoints.
     */
    breakpoints: DataBreakpoint[];
  }

  export interface SetDataBreakpointsResult {
    /**
     * Information about the data breakpoints. The array elements correspond to the elements of the input argument `breakpoints` array.
     */
    breakpoints: Breakpoint[];
  }

  export interface SetDebuggerPropertyParams {
    params: SetDebuggerPropertyParams;
  }

  export interface SetDebuggerPropertyResult {}

  export interface SetExceptionBreakpointsParams {
    /**
     * Set of exception filters specified by their ID. The set of all possible exception filters is defined by the `exceptionBreakpointFilters` capability. The `filter` and `filterOptions` sets are additive.
     */
    filters: string[];

    /**
     * Set of exception filters and their options. The set of all possible exception filters is defined by the `exceptionBreakpointFilters` capability. This attribute is only honored by a debug adapter if the corresponding capability `supportsExceptionFilterOptions` is true. The `filter` and `filterOptions` sets are additive.
     */
    filterOptions?: ExceptionFilterOptions[];

    /**
     * Configuration options for selected exceptions.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsExceptionOptions` is true.
     */
    exceptionOptions?: ExceptionOptions[];
  }

  export interface SetExceptionBreakpointsResult {
    /**
     * Information about the exception breakpoints or filters.
     * The breakpoints returned are in the same order as the elements of the `filters`, `filterOptions`, `exceptionOptions` arrays in the arguments. If both `filters` and `filterOptions` are given, the returned array must start with `filters` information first, followed by `filterOptions` information.
     */
    breakpoints?: Breakpoint[];
  }

  export interface SetExcludedCallersParams {
    callers: ExcludedCaller[];
  }

  export interface SetExcludedCallersResult {}

  export interface SetExpressionParams {
    /**
     * The l-value expression to assign to.
     */
    expression: string;

    /**
     * The value expression to assign to the l-value expression.
     */
    value: string;

    /**
     * Evaluate the expressions in the scope of this stack frame. If not specified, the expressions are evaluated in the global scope.
     */
    frameId?: integer;

    /**
     * Specifies how the resulting value should be formatted.
     */
    format?: ValueFormat;
  }

  export interface SetExpressionResult {
    /**
     * The new value of the expression.
     */
    value: string;

    /**
     * The type of the value.
     * This attribute should only be returned by a debug adapter if the corresponding capability `supportsVariableType` is true.
     */
    type?: string;

    /**
     * Properties of a value that can be used to determine how to render the result in the UI.
     */
    presentationHint?: VariablePresentationHint;

    /**
     * If `variablesReference` is > 0, the evaluate result is structured and its children can be retrieved by passing `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference?: integer;

    /**
     * The number of named child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    namedVariables?: integer;

    /**
     * The number of indexed child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    indexedVariables?: integer;
  }

  export interface SetFunctionBreakpointsParams {
    /**
     * The function names of the breakpoints.
     */
    breakpoints: FunctionBreakpoint[];
  }

  export interface SetFunctionBreakpointsResult {
    /**
     * Information about the breakpoints. The array elements correspond to the elements of the `breakpoints` array.
     */
    breakpoints: Breakpoint[];
  }

  export interface SetInstructionBreakpointsParams {
    /**
     * The instruction references of the breakpoints
     */
    breakpoints: InstructionBreakpoint[];
  }

  export interface SetInstructionBreakpointsResult {
    /**
     * Information about the breakpoints. The array elements correspond to the elements of the `breakpoints` array.
     */
    breakpoints: Breakpoint[];
  }

  export interface SetSourceMapSteppingParams {
    enabled: boolean;
  }

  export interface SetSourceMapSteppingResult {}

  export interface SetSymbolOptionsParams {}

  export interface SetSymbolOptionsResult {}

  export interface SetVariableParams {
    /**
     * The reference of the variable container. The `variablesReference` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference: integer;

    /**
     * The name of the variable in the container.
     */
    name: string;

    /**
     * The value of the variable.
     */
    value: string;

    /**
     * Specifies details on how to format the response value.
     */
    format?: ValueFormat;
  }

  export interface SetVariableResult {
    /**
     * The new value of the variable.
     */
    value: string;

    /**
     * The type of the new value. Typically shown in the UI when hovering over the value.
     */
    type?: string;

    /**
     * If `variablesReference` is > 0, the new value is structured and its children can be retrieved by passing `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference?: integer;

    /**
     * The number of named child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    namedVariables?: integer;

    /**
     * The number of indexed child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    indexedVariables?: integer;
  }

  export interface SourceParams {
    /**
     * Specifies the source content to load. Either `source.path` or `source.sourceReference` must be specified.
     */
    source?: Source;

    /**
     * The reference to the source. This is the same as `source.sourceReference`.
     * This is provided for backward compatibility since old clients do not understand the `source` attribute.
     */
    sourceReference: integer;
  }

  export interface SourceResult {
    /**
     * Content of the source reference.
     */
    content: string;

    /**
     * Content type (MIME type) of the source.
     */
    mimeType?: string;
  }

  export interface StackTraceParams {
    /**
     * Retrieve the stacktrace for this thread.
     */
    threadId: integer;

    /**
     * The index of the first frame to return; if omitted frames start at 0.
     */
    startFrame?: integer;

    /**
     * The maximum number of frames to return. If levels is not specified or 0, all frames are returned.
     */
    levels?: integer;

    /**
     * Specifies details on how to format the stack frames.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsValueFormattingOptions` is true.
     */
    format?: StackFrameFormat;
  }

  export interface StackTraceResult {
    /**
     * The frames of the stack frame. If the array has length zero, there are no stack frames available.
     * This means that there is no location information available.
     */
    stackFrames: StackFrame[];

    /**
     * The total number of frames available in the stack. If omitted or if `totalFrames` is larger than the available frames, a client is expected to request frames until a request returns less frames than requested (which indicates the end of the stack). Returning monotonically increasing `totalFrames` values for subsequent requests can be used to enforce paging in the client.
     */
    totalFrames?: integer;
  }

  export interface StartDebuggingParams {
    /**
     * Arguments passed to the new debug session. The arguments must only contain properties understood by the `launch` or `attach` requests of the debug adapter and they must not contain any client-specific properties (e.g. `type`) or client-specific features (e.g. substitutable 'variables').
     */
    configuration: object;

    /**
     * Indicates whether the new debug session should be started with a `launch` or `attach` request.
     */
    request: string;
  }

  export interface StartDebuggingResult {}

  export interface StartProfileParams {
    /**
     * Breakpoints where we should stop once hit.
     */
    stopAtBreakpoint?: number[];

    /**
     * Type of profile that should be taken
     */
    type: string;

    /**
     * Additional arguments for the type of profiler
     */
    params?: object;
  }

  export interface StartProfileResult {}

  export interface StartSelfProfileParams {
    /**
     * File where the profile should be saved
     */
    file: string;
  }

  export interface StartSelfProfileResult {}

  export interface StepBackParams {
    /**
     * Specifies the thread for which to resume execution for one step backwards (of the given granularity).
     */
    threadId: integer;

    /**
     * If this flag is true, all other suspended threads are not resumed.
     */
    singleThread?: boolean;

    /**
     * Stepping granularity to step. If no granularity is specified, a granularity of `statement` is assumed.
     */
    granularity?: SteppingGranularity;
  }

  export interface StepBackResult {}

  export interface StepInParams {
    /**
     * Specifies the thread for which to resume execution for one step-into (of the given granularity).
     */
    threadId: integer;

    /**
     * If this flag is true, all other suspended threads are not resumed.
     */
    singleThread?: boolean;

    /**
     * Id of the target to step into.
     */
    targetId?: integer;

    /**
     * Stepping granularity. If no granularity is specified, a granularity of `statement` is assumed.
     */
    granularity?: SteppingGranularity;
  }

  export interface StepInResult {}

  export interface StepInTargetsParams {
    /**
     * The stack frame for which to retrieve the possible step-in targets.
     */
    frameId: integer;
  }

  export interface StepInTargetsResult {
    /**
     * The possible step-in targets of the specified source location.
     */
    targets: StepInTarget[];
  }

  export interface StepOutParams {
    /**
     * Specifies the thread for which to resume execution for one step-out (of the given granularity).
     */
    threadId: integer;

    /**
     * If this flag is true, all other suspended threads are not resumed.
     */
    singleThread?: boolean;

    /**
     * Stepping granularity. If no granularity is specified, a granularity of `statement` is assumed.
     */
    granularity?: SteppingGranularity;
  }

  export interface StepOutResult {}

  export interface StopProfileParams {}

  export interface StopProfileResult {}

  export interface StopSelfProfileParams {}

  export interface StopSelfProfileResult {}

  export interface StoppedEventParams {
    /**
     * The reason for the event.
     * For backward compatibility this string is shown in the UI if the `description` attribute is missing (but it must not be translated).
     */
    reason:
      | 'step'
      | 'breakpoint'
      | 'exception'
      | 'pause'
      | 'entry'
      | 'goto'
      | 'function breakpoint'
      | 'data breakpoint'
      | 'instruction breakpoint';

    /**
     * The full reason for the event, e.g. 'Paused on exception'. This string is shown in the UI as is and can be translated.
     */
    description?: string;

    /**
     * The thread which was stopped.
     */
    threadId?: integer;

    /**
     * A value of true hints to the client that this event should not change the focus.
     */
    preserveFocusHint?: boolean;

    /**
     * Additional information. E.g. if reason is `exception`, text contains the exception name. This string is shown in the UI.
     */
    text?: string;

    /**
     * If `allThreadsStopped` is true, a debug adapter can announce that all threads have stopped.
     * - The client should use this information to enable that all threads can be expanded to access their stacktraces.
     * - If the attribute is missing or false, only the thread with the given `threadId` can be expanded.
     */
    allThreadsStopped?: boolean;

    /**
     * Ids of the breakpoints that triggered the event. In most cases there is only a single breakpoint but here are some examples for multiple breakpoints:
     * - Different types of breakpoints map to the same location.
     * - Multiple source breakpoints get collapsed to the same instruction by the compiler/runtime.
     * - Multiple function breakpoints with different function names map to the same location.
     */
    hitBreakpointIds?: integer[];
  }

  export interface SuggestDiagnosticToolEventParams {}

  export interface SuggestDisableSourcemapEventParams {
    /**
     * Source to be pretty printed.
     */
    source: Source;
  }

  export interface TerminateParams {
    /**
     * A value of true indicates that this `terminate` request is part of a restart sequence.
     */
    restart?: boolean;
  }

  export interface TerminateResult {}

  export interface TerminateThreadsParams {
    /**
     * Ids of threads to be terminated.
     */
    threadIds?: integer[];
  }

  export interface TerminateThreadsResult {}

  export interface TerminatedEventParams {
    /**
     * A debug adapter may set `restart` to true (or to an arbitrary object) to request that the client restarts the session.
     * The value is not interpreted by the client and passed unmodified as an attribute `__restart` to the `launch` and `attach` requests.
     */
    restart?: any[] | boolean | integer | null | number | object | string;
  }

  export interface ThreadEventParams {
    /**
     * The reason for the event.
     */
    reason: 'started' | 'exited';

    /**
     * The identifier of the thread.
     */
    threadId: integer;
  }

  export interface ThreadsParams {}

  export interface ThreadsResult {
    /**
     * All threads.
     */
    threads: Thread[];
  }

  export interface ToggleSkipFileStatusParams {
    /**
     * Url of file to be skipped.
     */
    resource?: string;

    /**
     * Source reference number of file.
     */
    sourceReference?: number;
  }

  export interface ToggleSkipFileStatusResult {}

  export interface VariablesParams {
    /**
     * The variable for which to retrieve its children. The `variablesReference` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference: integer;

    /**
     * Filter to limit the child variables to either named or indexed. If omitted, both types are fetched.
     */
    filter?: string;

    /**
     * The index of the first variable to return; if omitted children start at 0.
     */
    start?: integer;

    /**
     * The number of variables to return. If count is missing or 0, all variables are returned.
     */
    count?: integer;

    /**
     * Specifies details on how to format the Variable values.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsValueFormattingOptions` is true.
     */
    format?: ValueFormat;
  }

  export interface VariablesResult {
    /**
     * All (or a range) of variables for the given variable reference.
     */
    variables: Variable[];
  }

  export interface WriteMemoryParams {
    /**
     * Memory reference to the base location to which data should be written.
     */
    memoryReference: string;

    /**
     * Offset (in bytes) to be applied to the reference location before writing data. Can be negative.
     */
    offset?: integer;

    /**
     * Property to control partial writes. If true, the debug adapter should attempt to write memory even if the entire memory region is not writable. In such a case the debug adapter should stop after hitting the first byte of memory that cannot be written and return the number of bytes written in the response via the `offset` and `bytesWritten` properties.
     * If false or missing, a debug adapter should attempt to verify the region is writable before writing, and fail the response if it is not.
     */
    allowPartial?: boolean;

    /**
     * Bytes to write, encoded using base64.
     */
    data: string;
  }

  export interface WriteMemoryResult {
    /**
     * Property that should be returned when `allowPartial` is true to indicate the offset of the first byte of data successfully written. Can be negative.
     */
    offset?: integer;

    /**
     * Property that should be returned when `allowPartial` is true to indicate the number of bytes starting from address that were successfully written.
     */
    bytesWritten?: integer;
  }

  /**
   * A Variable is a name/value pair.
   * The `type` attribute is shown if space permits or when hovering over the variable's name.
   * The `kind` attribute is used to render additional properties of the variable, e.g. different icons can be used to indicate that a variable is public or private.
   * If the value is structured (has children), a handle is provided to retrieve the children with the `variables` request.
   * If the number of named or indexed children is large, the numbers should be returned via the `namedVariables` and `indexedVariables` attributes.
   * The client can use this information to present the children in a paged UI and fetch them in chunks.
   */
  export interface Variable {
    /**
     * The variable's name.
     */
    name: string;

    /**
     * The variable's value.
     * This can be a multi-line text, e.g. for a function the body of a function.
     * For structured variables (which do not have a simple value), it is recommended to provide a one-line representation of the structured object. This helps to identify the structured object in the collapsed state when its children are not yet visible.
     * An empty string can be used if no value should be shown in the UI.
     */
    value: string;

    /**
     * The type of the variable's value. Typically shown in the UI when hovering over the value.
     * This attribute should only be returned by a debug adapter if the corresponding capability `supportsVariableType` is true.
     */
    type?: string;

    /**
     * Properties of a variable that can be used to determine how to render the variable in the UI.
     */
    presentationHint?: VariablePresentationHint;

    /**
     * The evaluatable name of this variable which can be passed to the `evaluate` request to fetch the variable's value.
     */
    evaluateName?: string;

    /**
     * If `variablesReference` is > 0, the variable is structured and its children can be retrieved by passing `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference: integer;

    /**
     * The number of named child variables.
     * The client can use this information to present the children in a paged UI and fetch them in chunks.
     */
    namedVariables?: integer;

    /**
     * The number of indexed child variables.
     * The client can use this information to present the children in a paged UI and fetch them in chunks.
     */
    indexedVariables?: integer;

    /**
     * The memory reference for the variable if the variable represents executable code, such as a function pointer.
     * This attribute is only required if the corresponding capability `supportsMemoryReferences` is true.
     */
    memoryReference?: string;
  }

  /**
   * A Thread
   */
  export interface Thread {
    /**
     * Unique identifier for the thread.
     */
    id: integer;

    /**
     * The name of the thread.
     */
    name: string;
  }

  /**
   * A `StepInTarget` can be used in the `stepIn` request and determines into which single target the `stepIn` request should step.
   */
  export interface StepInTarget {
    /**
     * Unique identifier for a step-in target.
     */
    id: integer;

    /**
     * The name of the step-in target (shown in the UI).
     */
    label: string;

    /**
     * The line of the step-in target.
     */
    line?: integer;

    /**
     * Start position of the range covered by the step in target. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: integer;

    /**
     * The end line of the range covered by the step-in target.
     */
    endLine?: integer;

    /**
     * End position of the range covered by the step in target. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    endColumn?: integer;
  }

  /**
   * A Stackframe contains the source location.
   */
  export interface StackFrame {
    /**
     * An identifier for the stack frame. It must be unique across all threads.
     * This id can be used to retrieve the scopes of the frame with the `scopes` request or to restart the execution of a stack frame.
     */
    id: integer;

    /**
     * The name of the stack frame, typically a method name.
     */
    name: string;

    /**
     * The source of the frame.
     */
    source?: Source;

    /**
     * The line within the source of the frame. If the source attribute is missing or doesn't exist, `line` is 0 and should be ignored by the client.
     */
    line: integer;

    /**
     * Start position of the range covered by the stack frame. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based. If attribute `source` is missing or doesn't exist, `column` is 0 and should be ignored by the client.
     */
    column: integer;

    /**
     * The end line of the range covered by the stack frame.
     */
    endLine?: integer;

    /**
     * End position of the range covered by the stack frame. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    endColumn?: integer;

    /**
     * Indicates whether this frame can be restarted with the `restart` request. Clients should only use this if the debug adapter supports the `restart` request and the corresponding capability `supportsRestartRequest` is true. If a debug adapter has this capability, then `canRestart` defaults to `true` if the property is absent.
     */
    canRestart?: boolean;

    /**
     * A memory reference for the current instruction pointer in this frame.
     */
    instructionPointerReference?: string;

    /**
     * The module associated with this frame, if any.
     */
    moduleId?: integer | string;

    /**
     * A hint for how to present this frame in the UI.
     * A value of `label` can be used to indicate that the frame is an artificial frame that is used as a visual label or separator. A value of `subtle` can be used to change the appearance of a frame in a 'subtle' way.
     */
    presentationHint?: string;
  }

  export interface StackFrameFormat extends ValueFormat {
    /**
     * Displays parameters for the stack frame.
     */
    parameters?: boolean;

    /**
     * Displays the types of parameters for the stack frame.
     */
    parameterTypes?: boolean;

    /**
     * Displays the names of parameters for the stack frame.
     */
    parameterNames?: boolean;

    /**
     * Displays the values of parameters for the stack frame.
     */
    parameterValues?: boolean;

    /**
     * Displays the line number of the stack frame.
     */
    line?: boolean;

    /**
     * Displays the module of the stack frame.
     */
    module?: boolean;

    /**
     * Includes all stack frames, including those the debug adapter might otherwise hide.
     */
    includeAll?: boolean;
  }

  /**
   * Properties of a breakpoint passed to the `setInstructionBreakpoints` request
   */
  export interface InstructionBreakpoint {
    /**
     * The instruction reference of the breakpoint.
     * This should be a memory or instruction pointer reference from an `EvaluateResponse`, `Variable`, `StackFrame`, `GotoTarget`, or `Breakpoint`.
     */
    instructionReference: string;

    /**
     * The offset from the instruction reference.
     * This can be negative.
     */
    offset?: integer;

    /**
     * An expression for conditional breakpoints.
     * It is only honored by a debug adapter if the corresponding capability `supportsConditionalBreakpoints` is true.
     */
    condition?: string;

    /**
     * An expression that controls how many hits of the breakpoint are ignored.
     * The debug adapter is expected to interpret the expression as needed.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsHitConditionalBreakpoints` is true.
     */
    hitCondition?: string;
  }

  /**
   * Properties of a breakpoint passed to the `setFunctionBreakpoints` request.
   */
  export interface FunctionBreakpoint {
    /**
     * The name of the function.
     */
    name: string;

    /**
     * An expression for conditional breakpoints.
     * It is only honored by a debug adapter if the corresponding capability `supportsConditionalBreakpoints` is true.
     */
    condition?: string;

    /**
     * An expression that controls how many hits of the breakpoint are ignored.
     * The debug adapter is expected to interpret the expression as needed.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsHitConditionalBreakpoints` is true.
     */
    hitCondition?: string;
  }

  export interface ExcludedCaller {
    target: CallerLocation;

    caller: CallerLocation;
  }

  export interface CallerLocation {
    line: integer;

    column: integer;

    /**
     * Source to be pretty printed.
     */
    source: Source;
  }

  /**
   * An `ExceptionOptions` assigns configuration options to a set of exceptions.
   */
  export interface ExceptionOptions {
    /**
     * A path that selects a single or multiple exceptions in a tree. If `path` is missing, the whole tree is selected.
     * By convention the first segment of the path is a category that is used to group exceptions in the UI.
     */
    path?: ExceptionPathSegment[];

    /**
     * Condition when a thrown exception should result in a break.
     */
    breakMode: ExceptionBreakMode;
  }

  /**
   * An `ExceptionPathSegment` represents a segment in a path that is used to match leafs or nodes in a tree of exceptions.
   * If a segment consists of more than one name, it matches the names provided if `negate` is false or missing, or it matches anything except the names provided if `negate` is true.
   */
  export interface ExceptionPathSegment {
    /**
     * If false or missing this segment matches the names provided, otherwise it matches anything except the names provided.
     */
    negate?: boolean;

    /**
     * Depending on the value of `negate` the names that should match or not match.
     */
    names: string[];
  }

  /**
   * An `ExceptionFilterOptions` is used to specify an exception filter together with a condition for the `setExceptionBreakpoints` request.
   */
  export interface ExceptionFilterOptions {
    /**
     * ID of an exception filter returned by the `exceptionBreakpointFilters` capability.
     */
    filterId: string;

    /**
     * An expression for conditional exceptions.
     * The exception breaks into the debugger if the result of the condition is true.
     */
    condition?: string;
  }

  /**
   * Arguments for "setDebuggerProperty" request. Properties are determined by debugger.
   */
  export interface SetDebuggerPropertyParams {}

  /**
   * Properties of a data breakpoint passed to the `setDataBreakpoints` request.
   */
  export interface DataBreakpoint {
    /**
     * An id representing the data. This id is returned from the `dataBreakpointInfo` request.
     */
    dataId: string;

    /**
     * The access type of the data.
     */
    accessType?: DataBreakpointAccessType;

    /**
     * An expression for conditional breakpoints.
     */
    condition?: string;

    /**
     * An expression that controls how many hits of the breakpoint are ignored.
     * The debug adapter is expected to interpret the expression as needed.
     */
    hitCondition?: string;
  }

  /**
   * Properties of a breakpoint or logpoint passed to the `setBreakpoints` request.
   */
  export interface SourceBreakpoint {
    /**
     * The source line of the breakpoint or logpoint.
     */
    line: integer;

    /**
     * Start position within source line of the breakpoint or logpoint. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: integer;

    /**
     * The expression for conditional breakpoints.
     * It is only honored by a debug adapter if the corresponding capability `supportsConditionalBreakpoints` is true.
     */
    condition?: string;

    /**
     * The expression that controls how many hits of the breakpoint are ignored.
     * The debug adapter is expected to interpret the expression as needed.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsHitConditionalBreakpoints` is true.
     * If both this property and `condition` are specified, `hitCondition` should be evaluated only if the `condition` is met, and the debug adapter should stop only if both conditions are met.
     */
    hitCondition?: string;

    /**
     * If this attribute exists and is non-empty, the debug adapter must not 'break' (stop)
     * but log the message instead. Expressions within `{}` are interpolated.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsLogPoints` is true.
     * If either `hitCondition` or `condition` is specified, then the message should only be logged if those conditions are met.
     */
    logMessage?: string;
  }

  /**
   * A `Scope` is a named container for variables. Optionally a scope can map to a source or a range within a source.
   */
  export interface Scope {
    /**
     * Name of the scope such as 'Arguments', 'Locals', or 'Registers'. This string is shown in the UI as is and can be translated.
     */
    name: string;

    /**
     * A hint for how to present this scope in the UI. If this attribute is missing, the scope is shown with a generic UI.
     */
    presentationHint?: 'arguments' | 'locals' | 'registers';

    /**
     * The variables of this scope can be retrieved by passing the value of `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference: integer;

    /**
     * The number of named variables in this scope.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     */
    namedVariables?: integer;

    /**
     * The number of indexed variables in this scope.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     */
    indexedVariables?: integer;

    /**
     * If true, the number of variables in this scope is large or expensive to retrieve.
     */
    expensive: boolean;

    /**
     * The source for this scope.
     */
    source?: Source;

    /**
     * The start line of the range covered by this scope.
     */
    line?: integer;

    /**
     * Start position of the range covered by the scope. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: integer;

    /**
     * The end line of the range covered by this scope.
     */
    endLine?: integer;

    /**
     * End position of the range covered by the scope. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    endColumn?: integer;
  }

  /**
   * Arguments for `attach` request. Additional attributes are implementation specific.
   */
  export interface AttachRequestArguments {
    /**
     * Arbitrary data from the previous, restarted session.
     * The data is sent as the `restart` attribute of the `terminated` event.
     * The client should leave the data intact.
     */
    __restart?: any[] | boolean | integer | null | number | object | string;
  }

  /**
   * Arguments for `launch` request. Additional attributes are implementation specific.
   */
  export interface LaunchRequestArguments {
    /**
     * If true, the launch request should launch the program without enabling debugging.
     */
    noDebug?: boolean;

    /**
     * Arbitrary data from the previous, restarted session.
     * The data is sent as the `restart` attribute of the `terminated` event.
     * The client should leave the data intact.
     */
    __restart?: any[] | boolean | integer | null | number | object | string;
  }

  /**
   * The granularity of one 'step' in the stepping requests `next`, `stepIn`, `stepOut`, and `stepBack`.
   */
  export type SteppingGranularity = string;

  /**
   * A Module object represents a row in the modules view.
   * The `id` attribute identifies a module in the modules view and is used in a `module` event for identifying a module for adding, updating or deleting.
   * The `name` attribute is used to minimally render the module in the UI.
   *
   * Additional attributes can be added to the module. They show up in the module view if they have a corresponding `ColumnDescriptor`.
   *
   * To avoid an unnecessary proliferation of additional attributes with similar semantics but different names, we recommend to re-use attributes from the 'recommended' list below first, and only introduce new attributes if nothing appropriate could be found.
   */
  export interface Module {
    /**
     * Unique identifier for the module.
     */
    id: integer | string;

    /**
     * A name of the module.
     */
    name: string;

    /**
     * Logical full path to the module. The exact definition is implementation defined, but usually this would be a full path to the on-disk file for the module.
     */
    path?: string;

    /**
     * True if the module is optimized.
     */
    isOptimized?: boolean;

    /**
     * True if the module is considered 'user code' by a debugger that supports 'Just My Code'.
     */
    isUserCode?: boolean;

    /**
     * Version of Module.
     */
    version?: string;

    /**
     * User-understandable description of if symbols were found for the module (ex: 'Symbols Loaded', 'Symbols not found', etc.)
     */
    symbolStatus?: string;

    /**
     * Logical full path to the symbol file. The exact definition is implementation defined.
     */
    symbolFilePath?: string;

    /**
     * Module created or modified, encoded as a RFC 3339 timestamp.
     */
    dateTimeStamp?: string;

    /**
     * Address range covered by this module.
     */
    addressRange?: string;
  }

  /**
   * This interface represents a single command line argument split into a "prefix" and a "path" half. The optional "prefix" contains arbitrary text and the optional "path" contains a file system path. Concatenating both results in the original command line argument.
   */
  export interface LaunchVSCodeArgument {
    path?: string;

    prefix?: string;
  }

  /**
   * Logical areas that can be invalidated by the `invalidated` event.
   */
  export type InvalidatedAreas = string;

  /**
   * Names of checksum algorithms that may be supported by a debug adapter.
   */
  export type ChecksumAlgorithm = string;

  /**
   * A `ColumnDescriptor` specifies what module attribute to show in a column of the modules view, how to format it,
   * and what the column's label should be.
   * It is only used if the underlying UI actually supports this level of customization.
   */
  export interface ColumnDescriptor {
    /**
     * Name of the attribute rendered in this column.
     */
    attributeName: string;

    /**
     * Header UI label of column.
     */
    label: string;

    /**
     * Format to use for the rendered values in this column. TBD how the format strings looks like.
     */
    format?: string;

    /**
     * Datatype of values in this column. Defaults to `string` if not specified.
     */
    type?: string;

    /**
     * Width of this column in characters (hint only).
     */
    width?: integer;
  }

  /**
   * An `ExceptionBreakpointsFilter` is shown in the UI as an filter option for configuring how exceptions are dealt with.
   */
  export interface ExceptionBreakpointsFilter {
    /**
     * The internal ID of the filter option. This value is passed to the `setExceptionBreakpoints` request.
     */
    filter: string;

    /**
     * The name of the filter option. This is shown in the UI.
     */
    label: string;

    /**
     * A help text providing additional information about the exception filter. This string is typically shown as a hover and can be translated.
     */
    description?: string;

    /**
     * Initial value of the filter option. If not specified a value false is assumed.
     */
    default?: boolean;

    /**
     * Controls whether a condition can be specified for this filter option. If false or missing, a condition can not be set.
     */
    supportsCondition?: boolean;

    /**
     * A help text providing information about the condition. This string is shown as the placeholder text for a text box and can be translated.
     */
    conditionDescription?: string;
  }

  /**
   * A `GotoTarget` describes a code location that can be used as a target in the `goto` request.
   * The possible goto targets can be determined via the `gotoTargets` request.
   */
  export interface GotoTarget {
    /**
     * Unique identifier for a goto target. This is used in the `goto` request.
     */
    id: integer;

    /**
     * The name of the goto target (shown in the UI).
     */
    label: string;

    /**
     * The line of the goto target.
     */
    line: integer;

    /**
     * The column of the goto target.
     */
    column?: integer;

    /**
     * The end line of the range covered by the goto target.
     */
    endLine?: integer;

    /**
     * The end column of the range covered by the goto target.
     */
    endColumn?: integer;

    /**
     * A memory reference for the instruction pointer value represented by this target.
     */
    instructionPointerReference?: string;
  }

  /**
   * Detailed information about an exception that has occurred.
   */
  export interface ExceptionDetails {
    /**
     * Message contained in the exception.
     */
    message?: string;

    /**
     * Short type name of the exception object.
     */
    typeName?: string;

    /**
     * Fully-qualified type name of the exception object.
     */
    fullTypeName?: string;

    /**
     * An expression that can be evaluated in the current scope to obtain the exception object.
     */
    evaluateName?: string;

    /**
     * Stack trace at the time the exception was thrown.
     */
    stackTrace?: string;

    /**
     * Details of the exception contained by this exception, if any.
     */
    innerException?: ExceptionDetails[];
  }

  /**
   * This enumeration defines all possible conditions when a thrown exception should result in a break.
   * never: never breaks,
   * always: always breaks,
   * unhandled: breaks when exception unhandled,
   * userUnhandled: breaks if the exception is not handled by user code.
   */
  export type ExceptionBreakMode = string;

  export interface StackTraceParamsExtended extends StackTraceParams {
    noFuncEval?: boolean;
  }

  export interface VariablesParamsExtended extends VariablesParams {
    evaluationOptions?: EvaluationOptions;
  }

  /**
   * Options passed to expression evaluation commands ("evaluate" and "variables") to control how the evaluation occurs.
   */
  export interface EvaluationOptions {
    /**
     * Evaluate the expression as a statement.
     */
    treatAsStatement?: boolean;

    /**
     * Allow variables to be declared as part of the expression.
     */
    allowImplicitVars?: boolean;

    /**
     * Evaluate without side effects.
     */
    noSideEffects?: boolean;

    /**
     * Exclude funceval during evaluation.
     */
    noFuncEval?: boolean;

    /**
     * Exclude calling `ToString` during evaluation.
     */
    noToString?: boolean;

    /**
     * Evaluation should take place immediately if possible.
     */
    forceEvaluationNow?: boolean;

    /**
     * Exclude interpretation from evaluation methods.
     */
    forceRealFuncEval?: boolean;

    /**
     * Allow all threads to run during the evaluation.
     */
    runAllThreads?: boolean;

    /**
     * The 'raw' view of objects and structions should be shown - visualization improvements should be disabled.
     */
    rawStructures?: boolean;

    /**
     * Variables responses containing favorites should be filtered to only those items
     */
    filterToFavorites?: boolean;

    /**
     * Auto generated display strings for variables with favorites should not include field names.
     */
    simpleDisplayString?: boolean;
  }

  export interface EvaluateParamsExtended extends EvaluateParams {
    evaluationOptions?: EvaluationOptions;
  }

  /**
   * Properties of a variable that can be used to determine how to render the variable in the UI.
   */
  export interface VariablePresentationHint {
    /**
     * The kind of variable. Before introducing additional values, try to use the listed values.
     */
    kind?:
      | 'property'
      | 'method'
      | 'class'
      | 'data'
      | 'event'
      | 'baseClass'
      | 'innerClass'
      | 'interface'
      | 'mostDerivedClass'
      | 'virtual'
      | 'dataBreakpoint';

    /**
     * Set of attributes represented as an array of strings. Before introducing additional values, try to use the listed values.
     */
    attributes?: (
      | 'static'
      | 'constant'
      | 'readOnly'
      | 'rawString'
      | 'hasObjectId'
      | 'canHaveObjectId'
      | 'hasSideEffects'
      | 'hasDataBreakpoint'
    )[];

    /**
     * Visibility of variable. Before introducing additional values, try to use the listed values.
     */
    visibility?: 'public' | 'private' | 'protected' | 'internal' | 'final';

    /**
     * If true, clients can present the variable with a UI that supports a specific gesture to trigger its evaluation.
     * This mechanism can be used for properties that require executing code when retrieving their value and where the code execution can be expensive and/or produce side-effects. A typical example are properties based on a getter function.
     * Please note that in addition to the `lazy` flag, the variable's `variablesReference` is expected to refer to a variable that will provide the value through another `variable` request.
     */
    lazy?: boolean;
  }

  /**
   * Provides formatting information for a value.
   */
  export interface ValueFormat {
    /**
     * Display the value in hex.
     */
    hex?: boolean;
  }

  /**
   * Represents a single disassembled instruction.
   */
  export interface DisassembledInstruction {
    /**
     * The address of the instruction. Treated as a hex value if prefixed with `0x`, or as a decimal value otherwise.
     */
    address: string;

    /**
     * Raw bytes representing the instruction and its operands, in an implementation-defined format.
     */
    instructionBytes?: string;

    /**
     * Text representing the instruction and its operands, in an implementation-defined format.
     */
    instruction: string;

    /**
     * Name of the symbol that corresponds with the location of this instruction, if any.
     */
    symbol?: string;

    /**
     * Source location that corresponds to this instruction, if any.
     * Should always be set (if available) on the first instruction returned,
     * but can be omitted afterwards if this instruction maps to the same source file as the previous instruction.
     */
    location?: Source;

    /**
     * The line within the source location that corresponds to this instruction, if any.
     */
    line?: integer;

    /**
     * The column within the line that corresponds to this instruction, if any.
     */
    column?: integer;

    /**
     * The end line of the range that corresponds to this instruction, if any.
     */
    endLine?: integer;

    /**
     * The end column of the range that corresponds to this instruction, if any.
     */
    endColumn?: integer;
  }

  /**
   * This enumeration defines all possible access types for data breakpoints.
   */
  export type DataBreakpointAccessType = string;

  /**
   * `CompletionItems` are the suggestions returned from the `completions` request.
   */
  export interface CompletionItem {
    /**
     * The label of this completion item. By default this is also the text that is inserted when selecting this completion.
     */
    label: string;

    /**
     * If text is returned and not an empty string, then it is inserted instead of the label.
     */
    text?: string;

    /**
     * A string that should be used when comparing this item with other items. If not returned or an empty string, the `label` is used instead.
     */
    sortText?: string;

    /**
     * A human-readable string with additional information about this item, like type or symbol information.
     */
    detail?: string;

    /**
     * The item's type. Typically the client uses this information to render the item in the UI with an icon.
     */
    type?: CompletionItemType;

    /**
     * Start position (within the `text` attribute of the `completions` request) where the completion text is added. The position is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based. If the start position is omitted the text is added at the location specified by the `column` attribute of the `completions` request.
     */
    start?: integer;

    /**
     * Length determines how many characters are overwritten by the completion text and it is measured in UTF-16 code units. If missing the value 0 is assumed which results in the completion text being inserted.
     */
    length?: integer;

    /**
     * Determines the start of the new selection after the text has been inserted (or replaced). `selectionStart` is measured in UTF-16 code units and must be in the range 0 and length of the completion text. If omitted the selection starts at the end of the completion text.
     */
    selectionStart?: integer;

    /**
     * Determines the length of the new selection after the text has been inserted (or replaced) and it is measured in UTF-16 code units. The selection can not extend beyond the bounds of the completion text. If omitted the length is assumed to be 0.
     */
    selectionLength?: integer;
  }

  /**
   * Some predefined types for the CompletionItem. Please note that not all clients have specific icons for all of them.
   */
  export type CompletionItemType = string;

  export interface CapabilitiesExtended extends Capabilities {
    supportsDebuggerProperties?: boolean;

    supportsEvaluationOptions?: boolean;

    /**
     * The debug adapter supports the set symbol options request
     */
    supportsSetSymbolOptions?: boolean;
  }

  /**
   * Information about the capabilities of a debug adapter.
   */
  export interface Capabilities {
    /**
     * The debug adapter supports the `configurationDone` request.
     */
    supportsConfigurationDoneRequest?: boolean;

    /**
     * The debug adapter supports function breakpoints.
     */
    supportsFunctionBreakpoints?: boolean;

    /**
     * The debug adapter supports conditional breakpoints.
     */
    supportsConditionalBreakpoints?: boolean;

    /**
     * The debug adapter supports breakpoints that break execution after a specified number of hits.
     */
    supportsHitConditionalBreakpoints?: boolean;

    /**
     * The debug adapter supports a (side effect free) `evaluate` request for data hovers.
     */
    supportsEvaluateForHovers?: boolean;

    /**
     * Available exception filter options for the `setExceptionBreakpoints` request.
     */
    exceptionBreakpointFilters?: ExceptionBreakpointsFilter[];

    /**
     * The debug adapter supports stepping back via the `stepBack` and `reverseContinue` requests.
     */
    supportsStepBack?: boolean;

    /**
     * The debug adapter supports setting a variable to a value.
     */
    supportsSetVariable?: boolean;

    /**
     * The debug adapter supports restarting a frame.
     */
    supportsRestartFrame?: boolean;

    /**
     * The debug adapter supports the `gotoTargets` request.
     */
    supportsGotoTargetsRequest?: boolean;

    /**
     * The debug adapter supports the `stepInTargets` request.
     */
    supportsStepInTargetsRequest?: boolean;

    /**
     * The debug adapter supports the `completions` request.
     */
    supportsCompletionsRequest?: boolean;

    /**
     * The set of characters that should trigger completion in a REPL. If not specified, the UI should assume the `.` character.
     */
    completionTriggerCharacters?: string[];

    /**
     * The debug adapter supports the `modules` request.
     */
    supportsModulesRequest?: boolean;

    /**
     * The set of additional module information exposed by the debug adapter.
     */
    additionalModuleColumns?: ColumnDescriptor[];

    /**
     * Checksum algorithms supported by the debug adapter.
     */
    supportedChecksumAlgorithms?: ChecksumAlgorithm[];

    /**
     * The debug adapter supports the `restart` request. In this case a client should not implement `restart` by terminating and relaunching the adapter but by calling the `restart` request.
     */
    supportsRestartRequest?: boolean;

    /**
     * The debug adapter supports `exceptionOptions` on the `setExceptionBreakpoints` request.
     */
    supportsExceptionOptions?: boolean;

    /**
     * The debug adapter supports a `format` attribute on the `stackTrace`, `variables`, and `evaluate` requests.
     */
    supportsValueFormattingOptions?: boolean;

    /**
     * The debug adapter supports the `exceptionInfo` request.
     */
    supportsExceptionInfoRequest?: boolean;

    /**
     * The debug adapter supports the `terminateDebuggee` attribute on the `disconnect` request.
     */
    supportTerminateDebuggee?: boolean;

    /**
     * The debug adapter supports the `suspendDebuggee` attribute on the `disconnect` request.
     */
    supportSuspendDebuggee?: boolean;

    /**
     * The debug adapter supports the delayed loading of parts of the stack, which requires that both the `startFrame` and `levels` arguments and the `totalFrames` result of the `stackTrace` request are supported.
     */
    supportsDelayedStackTraceLoading?: boolean;

    /**
     * The debug adapter supports the `loadedSources` request.
     */
    supportsLoadedSourcesRequest?: boolean;

    /**
     * The debug adapter supports log points by interpreting the `logMessage` attribute of the `SourceBreakpoint`.
     */
    supportsLogPoints?: boolean;

    /**
     * The debug adapter supports the `terminateThreads` request.
     */
    supportsTerminateThreadsRequest?: boolean;

    /**
     * The debug adapter supports the `setExpression` request.
     */
    supportsSetExpression?: boolean;

    /**
     * The debug adapter supports the `terminate` request.
     */
    supportsTerminateRequest?: boolean;

    /**
     * The debug adapter supports data breakpoints.
     */
    supportsDataBreakpoints?: boolean;

    /**
     * The debug adapter supports the `readMemory` request.
     */
    supportsReadMemoryRequest?: boolean;

    /**
     * The debug adapter supports the `writeMemory` request.
     */
    supportsWriteMemoryRequest?: boolean;

    /**
     * The debug adapter supports the `disassemble` request.
     */
    supportsDisassembleRequest?: boolean;

    /**
     * The debug adapter supports the `cancel` request.
     */
    supportsCancelRequest?: boolean;

    /**
     * The debug adapter supports the `breakpointLocations` request.
     */
    supportsBreakpointLocationsRequest?: boolean;

    /**
     * The debug adapter supports the `clipboard` context value in the `evaluate` request.
     */
    supportsClipboardContext?: boolean;

    /**
     * The debug adapter supports stepping granularities (argument `granularity`) for the stepping requests.
     */
    supportsSteppingGranularity?: boolean;

    /**
     * The debug adapter supports adding breakpoints based on instruction references.
     */
    supportsInstructionBreakpoints?: boolean;

    /**
     * The debug adapter supports `filterOptions` as an argument on the `setExceptionBreakpoints` request.
     */
    supportsExceptionFilterOptions?: boolean;

    /**
     * The debug adapter supports the `singleThread` property on the execution requests (`continue`, `next`, `stepIn`, `stepOut`, `reverseContinue`, `stepBack`).
     */
    supportsSingleThreadExecutionRequests?: boolean;
  }

  /**
   * Properties of a breakpoint location returned from the `breakpointLocations` request.
   */
  export interface BreakpointLocation {
    /**
     * Start line of breakpoint location.
     */
    line: integer;

    /**
     * The start position of a breakpoint location. Position is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: integer;

    /**
     * The end line of breakpoint location if the location covers a range.
     */
    endLine?: integer;

    /**
     * The end position of a breakpoint location (if the location covers a range). Position is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    endColumn?: integer;
  }

  /**
   * A `Source` is a descriptor for source code.
   * It is returned from the debug adapter as part of a `StackFrame` and it is used by clients when specifying breakpoints.
   */
  export interface Source {
    /**
     * The short name of the source. Every source returned from the debug adapter has a name.
     * When sending a source to the debug adapter this name is optional.
     */
    name?: string;

    /**
     * The path of the source to be shown in the UI.
     * It is only used to locate and load the content of the source if no `sourceReference` is specified (or its value is 0).
     */
    path?: string;

    /**
     * If the value > 0 the contents of the source must be retrieved through the `source` request (even if a path is specified).
     * Since a `sourceReference` is only valid for a session, it can not be used to persist a source.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    sourceReference?: integer;

    /**
     * A hint for how to present the source in the UI.
     * A value of `deemphasize` can be used to indicate that the source is not available or that it is skipped on stepping.
     */
    presentationHint?: string;

    /**
     * The origin of this source. For example, 'internal module', 'inlined content from source map', etc.
     */
    origin?: string;

    /**
     * A list of sources that are related to this source. These may be the source that generated this source.
     */
    sources?: Source[];

    /**
     * Additional data that a debug adapter might want to loop through the client.
     * The client should leave the data intact and persist it across sessions. The client should not interpret the data.
     */
    adapterData?: any[] | boolean | integer | null | number | object | string;

    /**
     * The checksums associated with this file.
     */
    checksums?: Checksum[];
  }

  /**
   * The checksum of an item calculated by the specified algorithm.
   */
  export interface Checksum {
    /**
     * The algorithm used to calculate this checksum.
     */
    algorithm: ChecksumAlgorithm;

    /**
     * Value of the checksum, encoded as a hexadecimal value.
     */
    checksum: string;
  }

  /**
   * Information about a breakpoint created in `setBreakpoints`, `setFunctionBreakpoints`, `setInstructionBreakpoints`, or `setDataBreakpoints` requests.
   */
  export interface Breakpoint {
    /**
     * The identifier for the breakpoint. It is needed if breakpoint events are used to update or remove breakpoints.
     */
    id?: integer;

    /**
     * If true, the breakpoint could be set (but not necessarily at the desired location).
     */
    verified: boolean;

    /**
     * A message about the state of the breakpoint.
     * This is shown to the user and can be used to explain why a breakpoint could not be verified.
     */
    message?: string;

    /**
     * The source where the breakpoint is located.
     */
    source?: Source;

    /**
     * The start line of the actual range covered by the breakpoint.
     */
    line?: integer;

    /**
     * Start position of the source range covered by the breakpoint. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: integer;

    /**
     * The end line of the actual range covered by the breakpoint.
     */
    endLine?: integer;

    /**
     * End position of the source range covered by the breakpoint. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     * If no end line is given, then the end column is assumed to be in the start line.
     */
    endColumn?: integer;

    /**
     * A memory reference to where the breakpoint is set.
     */
    instructionReference?: string;

    /**
     * The offset from the instruction reference.
     * This can be negative.
     */
    offset?: integer;
  }
}

export default DAP;