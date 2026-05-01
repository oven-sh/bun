// GENERATED - DO NOT EDIT
export namespace DAP {
  /**
   * Base class of requests, responses, and events.
   */
  export type ProtocolMessage = {
    /**
     * Sequence number of the message (also known as message ID). The `seq` for the first message sent by a client or debug adapter is 1, and for each subsequent message is 1 greater than the previous message sent by that actor. `seq` can be used to order requests, responses, and events, and to associate requests with their corresponding responses. For protocol messages of type `request` the sequence number can be used to cancel the request.
     */
    seq: number;
    /**
     * Message type.
     */
    type: string;
  };
  export type Request = ProtocolMessage & {
    type: "request";
    /**
     * The command to execute.
     */
    command: string;
    /**
     * Object containing arguments for the command.
     */
    arguments?: unknown;
  };
  export type Event = ProtocolMessage & {
    type: "event";
    /**
     * Type of event.
     */
    event: string;
    /**
     * Event-specific information.
     */
    body?: unknown;
  };
  export type Response = ProtocolMessage & {
    type: "response";
    /**
     * Sequence number of the corresponding request.
     */
    request_seq: number;
    /**
     * Outcome of the request.
     * If true, the request was successful and the `body` attribute may contain the result of the request.
     * If the value is false, the attribute `message` contains the error in short form and the `body` may contain additional information (see `ErrorResponse.body.error`).
     */
    success: boolean;
    /**
     * The command requested.
     */
    command: string;
    /**
     * Contains the raw error in short form if `success` is false.
     * This raw error might be interpreted by the client and is not shown in the UI.
     * Some predefined values exist.
     */
    message?: string;
    /**
     * Contains request result if success is true and error details if success is false.
     */
    body?: unknown;
  };
  /**
   * On error (whenever `success` is false), the body can provide more details.
   */
  export type ErrorResponse = {
    /**
     * A structured error message.
     */
    error?: Message;
  };
  /**
   * Arguments for `cancel` request.
   */
  export type CancelRequest = {
    /**
     * The ID (attribute `seq`) of the request to cancel. If missing no request is cancelled.
     * Both a `requestId` and a `progressId` can be specified in one request.
     */
    requestId?: number;
    /**
     * The ID (attribute `progressId`) of the progress to cancel. If missing no progress is cancelled.
     * Both a `requestId` and a `progressId` can be specified in one request.
     */
    progressId?: string;
  };
  /**
   * Response to `cancel` request. This is just an acknowledgement, so no body field is required.
   */
  export type CancelResponse = {};
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
  export type InitializedEvent = {};
  /**
   * The event indicates that the execution of the debuggee has stopped due to some condition.
   * This can be caused by a breakpoint previously set, a stepping request has completed, by executing a debugger statement etc.
   */
  export type StoppedEvent = {
    /**
     * The reason for the event.
     * For backward compatibility this string is shown in the UI if the `description` attribute is missing (but it must not be translated).
     */
    reason: string;
    /**
     * The full reason for the event, e.g. 'Paused on exception'. This string is shown in the UI as is and can be translated.
     */
    description?: string;
    /**
     * The thread which was stopped.
     */
    threadId?: number;
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
    hitBreakpointIds?: number[];
  };
  /**
   * The event indicates that the execution of the debuggee has continued.
   * Please note: a debug adapter is not expected to send this event in response to a request that implies that execution continues, e.g. `launch` or `continue`.
   * It is only necessary to send a `continued` event if there was no previous request that implied this.
   */
  export type ContinuedEvent = {
    /**
     * The thread which was continued.
     */
    threadId: number;
    /**
     * If `allThreadsContinued` is true, a debug adapter can announce that all threads have continued.
     */
    allThreadsContinued?: boolean;
  };
  /**
   * The event indicates that the debuggee has exited and returns its exit code.
   */
  export type ExitedEvent = {
    /**
     * The exit code returned from the debuggee.
     */
    exitCode: number;
  };
  /**
   * The event indicates that debugging of the debuggee has terminated. This does **not** mean that the debuggee itself has exited.
   */
  export type TerminatedEvent = {
    /**
     * A debug adapter may set `restart` to true (or to an arbitrary object) to request that the client restarts the session.
     * The value is not interpreted by the client and passed unmodified as an attribute `__restart` to the `launch` and `attach` requests.
     */
    restart?: unknown;
  };
  /**
   * The event indicates that a thread has started or exited.
   */
  export type ThreadEvent = {
    /**
     * The reason for the event.
     */
    reason: string;
    /**
     * The identifier of the thread.
     */
    threadId: number;
  };
  /**
   * The event indicates that the target has produced some output.
   */
  export type OutputEvent = {
    /**
     * The output category. If not specified or if the category is not understood by the client, `console` is assumed.
     */
    category?: string;
    /**
     * The output to report.
     */
    output: string;
    /**
     * Support for keeping an output log organized by grouping related messages.
     */
    group?: "start" | "startCollapsed" | "end";
    /**
     * If an attribute `variablesReference` exists and its value is > 0, the output contains objects which can be retrieved by passing `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference?: number;
    /**
     * The source location where the output was produced.
     */
    source?: Source;
    /**
     * The source location's line where the output was produced.
     */
    line?: number;
    /**
     * The position in `line` where the output was produced. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: number;
    /**
     * Additional data to report. For the `telemetry` category the data is sent to telemetry, for the other categories the data is shown in JSON format.
     */
    data?: unknown;
  };
  /**
   * The event indicates that some information about a breakpoint has changed.
   */
  export type BreakpointEvent = {
    /**
     * The reason for the event.
     */
    reason: string;
    /**
     * The `id` attribute is used to find the target breakpoint, the other attributes are used as the new values.
     */
    breakpoint: Breakpoint;
  };
  /**
   * The event indicates that some information about a module has changed.
   */
  export type ModuleEvent = {
    /**
     * The reason for the event.
     */
    reason: "new" | "changed" | "removed";
    /**
     * The new, changed, or removed module. In case of `removed` only the module id is used.
     */
    module: Module;
  };
  /**
   * The event indicates that some source has been added, changed, or removed from the set of all loaded sources.
   */
  export type LoadedSourceEvent = {
    /**
     * The reason for the event.
     */
    reason: "new" | "changed" | "removed";
    /**
     * The new, changed, or removed source.
     */
    source: Source;
  };
  /**
   * The event indicates that the debugger has begun debugging a new process. Either one that it has launched, or one that it has attached to.
   */
  export type ProcessEvent = {
    /**
     * The logical name of the process. This is usually the full path to process's executable file. Example: /home/example/myproj/program.js.
     */
    name: string;
    /**
     * The system process id of the debugged process. This property is missing for non-system processes.
     */
    systemProcessId?: number;
    /**
     * If true, the process is running on the same computer as the debug adapter.
     */
    isLocalProcess?: boolean;
    /**
     * Describes how the debug engine started debugging this process.
     */
    startMethod?: "launch" | "attach" | "attachForSuspendedLaunch";
    /**
     * The size of a pointer or address for this process, in bits. This value may be used by clients when formatting addresses for display.
     */
    pointerSize?: number;
  };
  /**
   * The event indicates that one or more capabilities have changed.
   * Since the capabilities are dependent on the client and its UI, it might not be possible to change that at random times (or too late).
   * Consequently this event has a hint characteristic: a client can only be expected to make a 'best effort' in honoring individual capabilities but there are no guarantees.
   * Only changed capabilities need to be included, all other capabilities keep their values.
   */
  export type CapabilitiesEvent = {
    /**
     * The set of updated capabilities.
     */
    capabilities: Capabilities;
  };
  /**
   * The event signals that a long running operation is about to start and provides additional information for the client to set up a corresponding progress and cancellation UI.
   * The client is free to delay the showing of the UI in order to reduce flicker.
   * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
   */
  export type ProgressStartEvent = {
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
    requestId?: number;
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
  };
  /**
   * The event signals that the progress reporting needs to be updated with a new message and/or percentage.
   * The client does not have to update the UI immediately, but the clients needs to keep track of the message and/or percentage values.
   * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
   */
  export type ProgressUpdateEvent = {
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
  };
  /**
   * The event signals the end of the progress reporting with a final message.
   * This event should only be sent if the corresponding capability `supportsProgressReporting` is true.
   */
  export type ProgressEndEvent = {
    /**
     * The ID that was introduced in the initial `ProgressStartEvent`.
     */
    progressId: string;
    /**
     * More detailed progress message. If omitted, the previous message (if any) is used.
     */
    message?: string;
  };
  /**
   * This event signals that some state in the debug adapter has changed and requires that the client needs to re-render the data snapshot previously requested.
   * Debug adapters do not have to emit this event for runtime changes like stopped or thread events because in that case the client refetches the new state anyway. But the event can be used for example to refresh the UI after rendering formatting has changed in the debug adapter.
   * This event should only be sent if the corresponding capability `supportsInvalidatedEvent` is true.
   */
  export type InvalidatedEvent = {
    /**
     * Set of logical areas that got invalidated. This property has a hint characteristic: a client can only be expected to make a 'best effort' in honoring the areas but there are no guarantees. If this property is missing, empty, or if values are not understood, the client should assume a single value `all`.
     */
    areas?: InvalidatedAreas[];
    /**
     * If specified, the client only needs to refetch data related to this thread.
     */
    threadId?: number;
    /**
     * If specified, the client only needs to refetch data related to this stack frame (and the `threadId` is ignored).
     */
    stackFrameId?: number;
  };
  /**
   * This event indicates that some memory range has been updated. It should only be sent if the corresponding capability `supportsMemoryEvent` is true.
   * Clients typically react to the event by re-issuing a `readMemory` request if they show the memory identified by the `memoryReference` and if the updated memory range overlaps the displayed range. Clients should not make assumptions how individual memory references relate to each other, so they should not assume that they are part of a single continuous address range and might overlap.
   * Debug adapters can use this event to indicate that the contents of a memory range has changed due to some other request like `setVariable` or `setExpression`. Debug adapters are not expected to emit this event for each and every memory change of a running program, because that information is typically not available from debuggers and it would flood clients with too many events.
   */
  export type MemoryEvent = {
    /**
     * Memory reference of a memory range that has been updated.
     */
    memoryReference: string;
    /**
     * Starting offset in bytes where memory has been updated. Can be negative.
     */
    offset: number;
    /**
     * Number of bytes updated.
     */
    count: number;
  };
  /**
   * Arguments for `runInTerminal` request.
   */
  export type RunInTerminalRequest = {
    /**
     * What kind of terminal to launch. Defaults to `integrated` if not specified.
     */
    kind?: "integrated" | "external";
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
    env?: {};
    /**
     * This property should only be set if the corresponding capability `supportsArgsCanBeInterpretedByShell` is true. If the client uses an intermediary shell to launch the application, then the client must not attempt to escape characters with special meanings for the shell. The user is fully responsible for escaping as needed and that arguments using special characters may not be portable across shells.
     */
    argsCanBeInterpretedByShell?: boolean;
  };
  /**
   * Response to `runInTerminal` request.
   */
  export type RunInTerminalResponse = {
    /**
     * The process ID. The value should be less than or equal to 2147483647 (2^31-1).
     */
    processId?: number;
    /**
     * The process ID of the terminal shell. The value should be less than or equal to 2147483647 (2^31-1).
     */
    shellProcessId?: number;
  };
  /**
   * Arguments for `startDebugging` request.
   */
  export type StartDebuggingRequest = {
    /**
     * Arguments passed to the new debug session. The arguments must only contain properties understood by the `launch` or `attach` requests of the debug adapter and they must not contain any client-specific properties (e.g. `type`) or client-specific features (e.g. substitutable 'variables').
     */
    configuration: {};
    /**
     * Indicates whether the new debug session should be started with a `launch` or `attach` request.
     */
    request: "launch" | "attach";
  };
  /**
   * Response to `startDebugging` request. This is just an acknowledgement, so no body field is required.
   */
  export type StartDebuggingResponse = {};
  /**
   * Arguments for `initialize` request.
   */
  export type InitializeRequest = {
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
    pathFormat?: string;
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
  };
  /**
   * The capabilities of this debug adapter.
   */
  export type InitializeResponse = {};
  /**
   * Arguments for `configurationDone` request.
   */
  export type ConfigurationDoneRequest = {};
  /**
   * Response to `configurationDone` request. This is just an acknowledgement, so no body field is required.
   */
  export type ConfigurationDoneResponse = {};
  /**
   * Arguments for `launch` request. Additional attributes are implementation specific.
   */
  export type LaunchRequest = {
    /**
     * If true, the launch request should launch the program without enabling debugging.
     */
    noDebug?: boolean;
    /**
     * Arbitrary data from the previous, restarted session.
     * The data is sent as the `restart` attribute of the `terminated` event.
     * The client should leave the data intact.
     */
    __restart?: unknown;
  };
  /**
   * Response to `launch` request. This is just an acknowledgement, so no body field is required.
   */
  export type LaunchResponse = {};
  /**
   * Arguments for `attach` request. Additional attributes are implementation specific.
   */
  export type AttachRequest = {
    /**
     * Arbitrary data from the previous, restarted session.
     * The data is sent as the `restart` attribute of the `terminated` event.
     * The client should leave the data intact.
     */
    __restart?: unknown;
  };
  /**
   * Response to `attach` request. This is just an acknowledgement, so no body field is required.
   */
  export type AttachResponse = {};
  /**
   * Arguments for `restart` request.
   */
  export type RestartRequest = {
    /**
     * The latest version of the `launch` or `attach` configuration.
     */
    arguments?: unknown;
  };
  /**
   * Response to `restart` request. This is just an acknowledgement, so no body field is required.
   */
  export type RestartResponse = {};
  /**
   * Arguments for `disconnect` request.
   */
  export type DisconnectRequest = {
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
  };
  /**
   * Response to `disconnect` request. This is just an acknowledgement, so no body field is required.
   */
  export type DisconnectResponse = {};
  /**
   * Arguments for `terminate` request.
   */
  export type TerminateRequest = {
    /**
     * A value of true indicates that this `terminate` request is part of a restart sequence.
     */
    restart?: boolean;
  };
  /**
   * Response to `terminate` request. This is just an acknowledgement, so no body field is required.
   */
  export type TerminateResponse = {};
  /**
   * Arguments for `breakpointLocations` request.
   */
  export type BreakpointLocationsRequest = {
    /**
     * The source location of the breakpoints; either `source.path` or `source.sourceReference` must be specified.
     */
    source: Source;
    /**
     * Start line of range to search possible breakpoint locations in. If only the line is specified, the request returns all possible locations in that line.
     */
    line: number;
    /**
     * Start position within `line` to search possible breakpoint locations in. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based. If no column is given, the first position in the start line is assumed.
     */
    column?: number;
    /**
     * End line of range to search possible breakpoint locations in. If no end line is given, then the end line is assumed to be the start line.
     */
    endLine?: number;
    /**
     * End position within `endLine` to search possible breakpoint locations in. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based. If no end column is given, the last position in the end line is assumed.
     */
    endColumn?: number;
  };
  /**
   * Response to `breakpointLocations` request.
   * Contains possible locations for source breakpoints.
   */
  export type BreakpointLocationsResponse = {
    /**
     * Sorted set of possible breakpoint locations.
     */
    breakpoints: BreakpointLocation[];
  };
  /**
   * Arguments for `setBreakpoints` request.
   */
  export type SetBreakpointsRequest = {
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
    lines?: number[];
    /**
     * A value of true indicates that the underlying source has been modified which results in new breakpoint locations.
     */
    sourceModified?: boolean;
  };
  /**
   * Response to `setBreakpoints` request.
   * Returned is information about each breakpoint created by this request.
   * This includes the actual code location and whether the breakpoint could be verified.
   * The breakpoints returned are in the same order as the elements of the `breakpoints`
   * (or the deprecated `lines`) array in the arguments.
   */
  export type SetBreakpointsResponse = {
    /**
     * Information about the breakpoints.
     * The array elements are in the same order as the elements of the `breakpoints` (or the deprecated `lines`) array in the arguments.
     */
    breakpoints: Breakpoint[];
  };
  /**
   * Arguments for `setFunctionBreakpoints` request.
   */
  export type SetFunctionBreakpointsRequest = {
    /**
     * The function names of the breakpoints.
     */
    breakpoints: FunctionBreakpoint[];
  };
  /**
   * Response to `setFunctionBreakpoints` request.
   * Returned is information about each breakpoint created by this request.
   */
  export type SetFunctionBreakpointsResponse = {
    /**
     * Information about the breakpoints. The array elements correspond to the elements of the `breakpoints` array.
     */
    breakpoints: Breakpoint[];
  };
  /**
   * Arguments for `setExceptionBreakpoints` request.
   */
  export type SetExceptionBreakpointsRequest = {
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
  };
  /**
   * Response to `setExceptionBreakpoints` request.
   * The response contains an array of `Breakpoint` objects with information about each exception breakpoint or filter. The `Breakpoint` objects are in the same order as the elements of the `filters`, `filterOptions`, `exceptionOptions` arrays given as arguments. If both `filters` and `filterOptions` are given, the returned array must start with `filters` information first, followed by `filterOptions` information.
   * The `verified` property of a `Breakpoint` object signals whether the exception breakpoint or filter could be successfully created and whether the condition is valid. In case of an error the `message` property explains the problem. The `id` property can be used to introduce a unique ID for the exception breakpoint or filter so that it can be updated subsequently by sending breakpoint events.
   * For backward compatibility both the `breakpoints` array and the enclosing `body` are optional. If these elements are missing a client is not able to show problems for individual exception breakpoints or filters.
   */
  export type SetExceptionBreakpointsResponse = {
    /**
     * Information about the exception breakpoints or filters.
     * The breakpoints returned are in the same order as the elements of the `filters`, `filterOptions`, `exceptionOptions` arrays in the arguments. If both `filters` and `filterOptions` are given, the returned array must start with `filters` information first, followed by `filterOptions` information.
     */
    breakpoints?: Breakpoint[];
  };
  /**
   * Arguments for `dataBreakpointInfo` request.
   */
  export type DataBreakpointInfoRequest = {
    /**
     * Reference to the variable container if the data breakpoint is requested for a child of the container. The `variablesReference` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference?: number;
    /**
     * The name of the variable's child to obtain data breakpoint information for.
     * If `variablesReference` isn't specified, this can be an expression.
     */
    name: string;
    /**
     * When `name` is an expression, evaluate it in the scope of this stack frame. If not specified, the expression is evaluated in the global scope. When `variablesReference` is specified, this property has no effect.
     */
    frameId?: number;
  };
  /**
   * Response to `dataBreakpointInfo` request.
   */
  export type DataBreakpointInfoResponse = {
    /**
     * An identifier for the data on which a data breakpoint can be registered with the `setDataBreakpoints` request or null if no data breakpoint is available. If a `variablesReference` or `frameId` is passed, the `dataId` is valid in the current suspended state, otherwise it's valid indefinitely. See 'Lifetime of Object References' in the Overview section for details. Breakpoints set using the `dataId` in the `setDataBreakpoints` request may outlive the lifetime of the associated `dataId`.
     */
    dataId: unknown;
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
  };
  /**
   * Arguments for `setDataBreakpoints` request.
   */
  export type SetDataBreakpointsRequest = {
    /**
     * The contents of this array replaces all existing data breakpoints. An empty array clears all data breakpoints.
     */
    breakpoints: DataBreakpoint[];
  };
  /**
   * Response to `setDataBreakpoints` request.
   * Returned is information about each breakpoint created by this request.
   */
  export type SetDataBreakpointsResponse = {
    /**
     * Information about the data breakpoints. The array elements correspond to the elements of the input argument `breakpoints` array.
     */
    breakpoints: Breakpoint[];
  };
  /**
   * Arguments for `setInstructionBreakpoints` request
   */
  export type SetInstructionBreakpointsRequest = {
    /**
     * The instruction references of the breakpoints
     */
    breakpoints: InstructionBreakpoint[];
  };
  /**
   * Response to `setInstructionBreakpoints` request
   */
  export type SetInstructionBreakpointsResponse = {
    /**
     * Information about the breakpoints. The array elements correspond to the elements of the `breakpoints` array.
     */
    breakpoints: Breakpoint[];
  };
  /**
   * Arguments for `continue` request.
   */
  export type ContinueRequest = {
    /**
     * Specifies the active thread. If the debug adapter supports single thread execution (see `supportsSingleThreadExecutionRequests`) and the argument `singleThread` is true, only the thread with this ID is resumed.
     */
    threadId: number;
    /**
     * If this flag is true, execution is resumed only for the thread with given `threadId`.
     */
    singleThread?: boolean;
  };
  /**
   * Response to `continue` request.
   */
  export type ContinueResponse = {
    /**
     * The value true (or a missing property) signals to the client that all threads have been resumed. The value false indicates that not all threads were resumed.
     */
    allThreadsContinued?: boolean;
  };
  /**
   * Arguments for `next` request.
   */
  export type NextRequest = {
    /**
     * Specifies the thread for which to resume execution for one step (of the given granularity).
     */
    threadId: number;
    /**
     * If this flag is true, all other suspended threads are not resumed.
     */
    singleThread?: boolean;
    /**
     * Stepping granularity. If no granularity is specified, a granularity of `statement` is assumed.
     */
    granularity?: SteppingGranularity;
  };
  /**
   * Response to `next` request. This is just an acknowledgement, so no body field is required.
   */
  export type NextResponse = {};
  /**
   * Arguments for `stepIn` request.
   */
  export type StepInRequest = {
    /**
     * Specifies the thread for which to resume execution for one step-into (of the given granularity).
     */
    threadId: number;
    /**
     * If this flag is true, all other suspended threads are not resumed.
     */
    singleThread?: boolean;
    /**
     * Id of the target to step into.
     */
    targetId?: number;
    /**
     * Stepping granularity. If no granularity is specified, a granularity of `statement` is assumed.
     */
    granularity?: SteppingGranularity;
  };
  /**
   * Response to `stepIn` request. This is just an acknowledgement, so no body field is required.
   */
  export type StepInResponse = {};
  /**
   * Arguments for `stepOut` request.
   */
  export type StepOutRequest = {
    /**
     * Specifies the thread for which to resume execution for one step-out (of the given granularity).
     */
    threadId: number;
    /**
     * If this flag is true, all other suspended threads are not resumed.
     */
    singleThread?: boolean;
    /**
     * Stepping granularity. If no granularity is specified, a granularity of `statement` is assumed.
     */
    granularity?: SteppingGranularity;
  };
  /**
   * Response to `stepOut` request. This is just an acknowledgement, so no body field is required.
   */
  export type StepOutResponse = {};
  /**
   * Arguments for `stepBack` request.
   */
  export type StepBackRequest = {
    /**
     * Specifies the thread for which to resume execution for one step backwards (of the given granularity).
     */
    threadId: number;
    /**
     * If this flag is true, all other suspended threads are not resumed.
     */
    singleThread?: boolean;
    /**
     * Stepping granularity to step. If no granularity is specified, a granularity of `statement` is assumed.
     */
    granularity?: SteppingGranularity;
  };
  /**
   * Response to `stepBack` request. This is just an acknowledgement, so no body field is required.
   */
  export type StepBackResponse = {};
  /**
   * Arguments for `reverseContinue` request.
   */
  export type ReverseContinueRequest = {
    /**
     * Specifies the active thread. If the debug adapter supports single thread execution (see `supportsSingleThreadExecutionRequests`) and the `singleThread` argument is true, only the thread with this ID is resumed.
     */
    threadId: number;
    /**
     * If this flag is true, backward execution is resumed only for the thread with given `threadId`.
     */
    singleThread?: boolean;
  };
  /**
   * Response to `reverseContinue` request. This is just an acknowledgement, so no body field is required.
   */
  export type ReverseContinueResponse = {};
  /**
   * Arguments for `restartFrame` request.
   */
  export type RestartFrameRequest = {
    /**
     * Restart the stack frame identified by `frameId`. The `frameId` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    frameId: number;
  };
  /**
   * Response to `restartFrame` request. This is just an acknowledgement, so no body field is required.
   */
  export type RestartFrameResponse = {};
  /**
   * Arguments for `goto` request.
   */
  export type GotoRequest = {
    /**
     * Set the goto target for this thread.
     */
    threadId: number;
    /**
     * The location where the debuggee will continue to run.
     */
    targetId: number;
  };
  /**
   * Response to `goto` request. This is just an acknowledgement, so no body field is required.
   */
  export type GotoResponse = {};
  /**
   * Arguments for `pause` request.
   */
  export type PauseRequest = {
    /**
     * Pause execution for this thread.
     */
    threadId: number;
  };
  /**
   * Response to `pause` request. This is just an acknowledgement, so no body field is required.
   */
  export type PauseResponse = {};
  /**
   * Arguments for `stackTrace` request.
   */
  export type StackTraceRequest = {
    /**
     * Retrieve the stacktrace for this thread.
     */
    threadId: number;
    /**
     * The index of the first frame to return; if omitted frames start at 0.
     */
    startFrame?: number;
    /**
     * The maximum number of frames to return. If levels is not specified or 0, all frames are returned.
     */
    levels?: number;
    /**
     * Specifies details on how to format the stack frames.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsValueFormattingOptions` is true.
     */
    format?: StackFrameFormat;
  };
  /**
   * Response to `stackTrace` request.
   */
  export type StackTraceResponse = {
    /**
     * The frames of the stack frame. If the array has length zero, there are no stack frames available.
     * This means that there is no location information available.
     */
    stackFrames: StackFrame[];
    /**
     * The total number of frames available in the stack. If omitted or if `totalFrames` is larger than the available frames, a client is expected to request frames until a request returns less frames than requested (which indicates the end of the stack). Returning monotonically increasing `totalFrames` values for subsequent requests can be used to enforce paging in the client.
     */
    totalFrames?: number;
  };
  /**
   * Arguments for `scopes` request.
   */
  export type ScopesRequest = {
    /**
     * Retrieve the scopes for the stack frame identified by `frameId`. The `frameId` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    frameId: number;
  };
  /**
   * Response to `scopes` request.
   */
  export type ScopesResponse = {
    /**
     * The scopes of the stack frame. If the array has length zero, there are no scopes available.
     */
    scopes: Scope[];
  };
  /**
   * Arguments for `variables` request.
   */
  export type VariablesRequest = {
    /**
     * The variable for which to retrieve its children. The `variablesReference` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference: number;
    /**
     * Filter to limit the child variables to either named or indexed. If omitted, both types are fetched.
     */
    filter?: "indexed" | "named";
    /**
     * The index of the first variable to return; if omitted children start at 0.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsVariablePaging` is true.
     */
    start?: number;
    /**
     * The number of variables to return. If count is missing or 0, all variables are returned.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsVariablePaging` is true.
     */
    count?: number;
    /**
     * Specifies details on how to format the Variable values.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsValueFormattingOptions` is true.
     */
    format?: ValueFormat;
  };
  /**
   * Response to `variables` request.
   */
  export type VariablesResponse = {
    /**
     * All (or a range) of variables for the given variable reference.
     */
    variables: Variable[];
  };
  /**
   * Arguments for `setVariable` request.
   */
  export type SetVariableRequest = {
    /**
     * The reference of the variable container. The `variablesReference` must have been obtained in the current suspended state. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference: number;
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
  };
  /**
   * Response to `setVariable` request.
   */
  export type SetVariableResponse = {
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
    variablesReference?: number;
    /**
     * The number of named child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    namedVariables?: number;
    /**
     * The number of indexed child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    indexedVariables?: number;
    /**
     * A memory reference to a location appropriate for this result.
     * For pointer type eval results, this is generally a reference to the memory address contained in the pointer.
     * This attribute may be returned by a debug adapter if corresponding capability `supportsMemoryReferences` is true.
     */
    memoryReference?: string;
  };
  /**
   * Arguments for `source` request.
   */
  export type SourceRequest = {
    /**
     * Specifies the source content to load. Either `source.path` or `source.sourceReference` must be specified.
     */
    source?: Source;
    /**
     * The reference to the source. This is the same as `source.sourceReference`.
     * This is provided for backward compatibility since old clients do not understand the `source` attribute.
     */
    sourceReference: number;
  };
  /**
   * Response to `source` request.
   */
  export type SourceResponse = {
    /**
     * Content of the source reference.
     */
    content: string;
    /**
     * Content type (MIME type) of the source.
     */
    mimeType?: string;
  };
  /**
   * Response to `threads` request.
   */
  export type ThreadsResponse = {
    /**
     * All threads.
     */
    threads: Thread[];
  };
  /**
   * Arguments for `terminateThreads` request.
   */
  export type TerminateThreadsRequest = {
    /**
     * Ids of threads to be terminated.
     */
    threadIds?: number[];
  };
  /**
   * Response to `terminateThreads` request. This is just an acknowledgement, no body field is required.
   */
  export type TerminateThreadsResponse = {};
  /**
   * Arguments for `modules` request.
   */
  export type ModulesRequest = {
    /**
     * The index of the first module to return; if omitted modules start at 0.
     */
    startModule?: number;
    /**
     * The number of modules to return. If `moduleCount` is not specified or 0, all modules are returned.
     */
    moduleCount?: number;
  };
  /**
   * Response to `modules` request.
   */
  export type ModulesResponse = {
    /**
     * All modules or range of modules.
     */
    modules: Module[];
    /**
     * The total number of modules available.
     */
    totalModules?: number;
  };
  /**
   * Arguments for `loadedSources` request.
   */
  export type LoadedSourcesRequest = {};
  /**
   * Response to `loadedSources` request.
   */
  export type LoadedSourcesResponse = {
    /**
     * Set of loaded sources.
     */
    sources: Source[];
  };
  /**
   * Arguments for `evaluate` request.
   */
  export type EvaluateRequest = {
    /**
     * The expression to evaluate.
     */
    expression: string;
    /**
     * Evaluate the expression in the scope of this stack frame. If not specified, the expression is evaluated in the global scope.
     */
    frameId?: number;
    /**
     * The context in which the evaluate request is used.
     */
    context?: string;
    /**
     * Specifies details on how to format the result.
     * The attribute is only honored by a debug adapter if the corresponding capability `supportsValueFormattingOptions` is true.
     */
    format?: ValueFormat;
  };
  /**
   * Response to `evaluate` request.
   */
  export type EvaluateResponse = {
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
    variablesReference: number;
    /**
     * The number of named child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    namedVariables?: number;
    /**
     * The number of indexed child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    indexedVariables?: number;
    /**
     * A memory reference to a location appropriate for this result.
     * For pointer type eval results, this is generally a reference to the memory address contained in the pointer.
     * This attribute may be returned by a debug adapter if corresponding capability `supportsMemoryReferences` is true.
     */
    memoryReference?: string;
  };
  /**
   * Arguments for `setExpression` request.
   */
  export type SetExpressionRequest = {
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
    frameId?: number;
    /**
     * Specifies how the resulting value should be formatted.
     */
    format?: ValueFormat;
  };
  /**
   * Response to `setExpression` request.
   */
  export type SetExpressionResponse = {
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
    variablesReference?: number;
    /**
     * The number of named child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    namedVariables?: number;
    /**
     * The number of indexed child variables.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     * The value should be less than or equal to 2147483647 (2^31-1).
     */
    indexedVariables?: number;
    /**
     * A memory reference to a location appropriate for this result.
     * For pointer type eval results, this is generally a reference to the memory address contained in the pointer.
     * This attribute may be returned by a debug adapter if corresponding capability `supportsMemoryReferences` is true.
     */
    memoryReference?: string;
  };
  /**
   * Arguments for `stepInTargets` request.
   */
  export type StepInTargetsRequest = {
    /**
     * The stack frame for which to retrieve the possible step-in targets.
     */
    frameId: number;
  };
  /**
   * Response to `stepInTargets` request.
   */
  export type StepInTargetsResponse = {
    /**
     * The possible step-in targets of the specified source location.
     */
    targets: StepInTarget[];
  };
  /**
   * Arguments for `gotoTargets` request.
   */
  export type GotoTargetsRequest = {
    /**
     * The source location for which the goto targets are determined.
     */
    source: Source;
    /**
     * The line location for which the goto targets are determined.
     */
    line: number;
    /**
     * The position within `line` for which the goto targets are determined. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: number;
  };
  /**
   * Response to `gotoTargets` request.
   */
  export type GotoTargetsResponse = {
    /**
     * The possible goto targets of the specified location.
     */
    targets: GotoTarget[];
  };
  /**
   * Arguments for `completions` request.
   */
  export type CompletionsRequest = {
    /**
     * Returns completions in the scope of this stack frame. If not specified, the completions are returned for the global scope.
     */
    frameId?: number;
    /**
     * One or more source lines. Typically this is the text users have typed into the debug console before they asked for completion.
     */
    text: string;
    /**
     * The position within `text` for which to determine the completion proposals. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column: number;
    /**
     * A line for which to determine the completion proposals. If missing the first line of the text is assumed.
     */
    line?: number;
  };
  /**
   * Response to `completions` request.
   */
  export type CompletionsResponse = {
    /**
     * The possible completions for .
     */
    targets: CompletionItem[];
  };
  /**
   * Arguments for `exceptionInfo` request.
   */
  export type ExceptionInfoRequest = {
    /**
     * Thread for which exception information should be retrieved.
     */
    threadId: number;
  };
  /**
   * Response to `exceptionInfo` request.
   */
  export type ExceptionInfoResponse = {
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
  };
  /**
   * Arguments for `readMemory` request.
   */
  export type ReadMemoryRequest = {
    /**
     * Memory reference to the base location from which data should be read.
     */
    memoryReference: string;
    /**
     * Offset (in bytes) to be applied to the reference location before reading data. Can be negative.
     */
    offset?: number;
    /**
     * Number of bytes to read at the specified location and offset.
     */
    count: number;
  };
  /**
   * Response to `readMemory` request.
   */
  export type ReadMemoryResponse = {
    /**
     * The address of the first byte of data returned.
     * Treated as a hex value if prefixed with `0x`, or as a decimal value otherwise.
     */
    address: string;
    /**
     * The number of unreadable bytes encountered after the last successfully read byte.
     * This can be used to determine the number of bytes that should be skipped before a subsequent `readMemory` request succeeds.
     */
    unreadableBytes?: number;
    /**
     * The bytes read from memory, encoded using base64. If the decoded length of `data` is less than the requested `count` in the original `readMemory` request, and `unreadableBytes` is zero or omitted, then the client should assume it's reached the end of readable memory.
     */
    data?: string;
  };
  /**
   * Arguments for `writeMemory` request.
   */
  export type WriteMemoryRequest = {
    /**
     * Memory reference to the base location to which data should be written.
     */
    memoryReference: string;
    /**
     * Offset (in bytes) to be applied to the reference location before writing data. Can be negative.
     */
    offset?: number;
    /**
     * Property to control partial writes. If true, the debug adapter should attempt to write memory even if the entire memory region is not writable. In such a case the debug adapter should stop after hitting the first byte of memory that cannot be written and return the number of bytes written in the response via the `offset` and `bytesWritten` properties.
     * If false or missing, a debug adapter should attempt to verify the region is writable before writing, and fail the response if it is not.
     */
    allowPartial?: boolean;
    /**
     * Bytes to write, encoded using base64.
     */
    data: string;
  };
  /**
   * Response to `writeMemory` request.
   */
  export type WriteMemoryResponse = {
    /**
     * Property that should be returned when `allowPartial` is true to indicate the offset of the first byte of data successfully written. Can be negative.
     */
    offset?: number;
    /**
     * Property that should be returned when `allowPartial` is true to indicate the number of bytes starting from address that were successfully written.
     */
    bytesWritten?: number;
  };
  /**
   * Arguments for `disassemble` request.
   */
  export type DisassembleRequest = {
    /**
     * Memory reference to the base location containing the instructions to disassemble.
     */
    memoryReference: string;
    /**
     * Offset (in bytes) to be applied to the reference location before disassembling. Can be negative.
     */
    offset?: number;
    /**
     * Offset (in instructions) to be applied after the byte offset (if any) before disassembling. Can be negative.
     */
    instructionOffset?: number;
    /**
     * Number of instructions to disassemble starting at the specified location and offset.
     * An adapter must return exactly this number of instructions - any unavailable instructions should be replaced with an implementation-defined 'invalid instruction' value.
     */
    instructionCount: number;
    /**
     * If true, the adapter should attempt to resolve memory addresses and other values to symbolic names.
     */
    resolveSymbols?: boolean;
  };
  /**
   * Response to `disassemble` request.
   */
  export type DisassembleResponse = {
    /**
     * The list of disassembled instructions.
     */
    instructions: DisassembledInstruction[];
  };
  /**
   * Information about the capabilities of a debug adapter.
   */
  export type Capabilities = {
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
  };
  /**
   * An `ExceptionBreakpointsFilter` is shown in the UI as an filter option for configuring how exceptions are dealt with.
   */
  export type ExceptionBreakpointsFilter = {
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
  };
  /**
   * A structured message object. Used to return errors from requests.
   */
  export type Message = {
    /**
     * Unique (within a debug adapter implementation) identifier for the message. The purpose of these error IDs is to help extension authors that have the requirement that every user visible error message needs a corresponding error number, so that users or customer support can find information about the specific error more easily.
     */
    id: number;
    /**
     * A format string for the message. Embedded variables have the form `{name}`.
     * If variable name starts with an underscore character, the variable does not contain user data (PII) and can be safely used for telemetry purposes.
     */
    format: string;
    /**
     * An object used as a dictionary for looking up the variables in the format string.
     */
    variables?: {};
    /**
     * If true send to telemetry.
     */
    sendTelemetry?: boolean;
    /**
     * If true show user.
     */
    showUser?: boolean;
    /**
     * A url where additional information about this message can be found.
     */
    url?: string;
    /**
     * A label that is presented to the user as the UI for opening the url.
     */
    urlLabel?: string;
  };
  /**
   * A Module object represents a row in the modules view.
   * The `id` attribute identifies a module in the modules view and is used in a `module` event for identifying a module for adding, updating or deleting.
   * The `name` attribute is used to minimally render the module in the UI.
   *
   * Additional attributes can be added to the module. They show up in the module view if they have a corresponding `ColumnDescriptor`.
   *
   * To avoid an unnecessary proliferation of additional attributes with similar semantics but different names, we recommend to re-use attributes from the 'recommended' list below first, and only introduce new attributes if nothing appropriate could be found.
   */
  export type Module = {
    /**
     * Unique identifier for the module.
     */
    id: unknown;
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
  };
  /**
   * A `ColumnDescriptor` specifies what module attribute to show in a column of the modules view, how to format it,
   * and what the column's label should be.
   * It is only used if the underlying UI actually supports this level of customization.
   */
  export type ColumnDescriptor = {
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
    type?: "string" | "number" | "boolean" | "unixTimestampUTC";
    /**
     * Width of this column in characters (hint only).
     */
    width?: number;
  };
  /**
   * A Thread
   */
  export type Thread = {
    /**
     * Unique identifier for the thread.
     */
    id: number;
    /**
     * The name of the thread.
     */
    name: string;
  };
  /**
   * A `Source` is a descriptor for source code.
   * It is returned from the debug adapter as part of a `StackFrame` and it is used by clients when specifying breakpoints.
   */
  export type Source = {
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
    sourceReference?: number;
    /**
     * A hint for how to present the source in the UI.
     * A value of `deemphasize` can be used to indicate that the source is not available or that it is skipped on stepping.
     */
    presentationHint?: "normal" | "emphasize" | "deemphasize";
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
    adapterData?: unknown;
    /**
     * The checksums associated with this file.
     */
    checksums?: Checksum[];
  };
  /**
   * A Stackframe contains the source location.
   */
  export type StackFrame = {
    /**
     * An identifier for the stack frame. It must be unique across all threads.
     * This id can be used to retrieve the scopes of the frame with the `scopes` request or to restart the execution of a stack frame.
     */
    id: number;
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
    line: number;
    /**
     * Start position of the range covered by the stack frame. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based. If attribute `source` is missing or doesn't exist, `column` is 0 and should be ignored by the client.
     */
    column: number;
    /**
     * The end line of the range covered by the stack frame.
     */
    endLine?: number;
    /**
     * End position of the range covered by the stack frame. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    endColumn?: number;
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
    moduleId?: unknown;
    /**
     * A hint for how to present this frame in the UI.
     * A value of `label` can be used to indicate that the frame is an artificial frame that is used as a visual label or separator. A value of `subtle` can be used to change the appearance of a frame in a 'subtle' way.
     */
    presentationHint?: "normal" | "label" | "subtle";
  };
  /**
   * A `Scope` is a named container for variables. Optionally a scope can map to a source or a range within a source.
   */
  export type Scope = {
    /**
     * Name of the scope such as 'Arguments', 'Locals', or 'Registers'. This string is shown in the UI as is and can be translated.
     */
    name: string;
    /**
     * A hint for how to present this scope in the UI. If this attribute is missing, the scope is shown with a generic UI.
     */
    presentationHint?: string;
    /**
     * The variables of this scope can be retrieved by passing the value of `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details.
     */
    variablesReference: number;
    /**
     * The number of named variables in this scope.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     */
    namedVariables?: number;
    /**
     * The number of indexed variables in this scope.
     * The client can use this information to present the variables in a paged UI and fetch them in chunks.
     */
    indexedVariables?: number;
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
    line?: number;
    /**
     * Start position of the range covered by the scope. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: number;
    /**
     * The end line of the range covered by this scope.
     */
    endLine?: number;
    /**
     * End position of the range covered by the scope. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    endColumn?: number;
  };
  /**
   * A Variable is a name/value pair.
   * The `type` attribute is shown if space permits or when hovering over the variable's name.
   * The `kind` attribute is used to render additional properties of the variable, e.g. different icons can be used to indicate that a variable is public or private.
   * If the value is structured (has children), a handle is provided to retrieve the children with the `variables` request.
   * If the number of named or indexed children is large, the numbers should be returned via the `namedVariables` and `indexedVariables` attributes.
   * The client can use this information to present the children in a paged UI and fetch them in chunks.
   */
  export type Variable = {
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
    variablesReference: number;
    /**
     * The number of named child variables.
     * The client can use this information to present the children in a paged UI and fetch them in chunks.
     */
    namedVariables?: number;
    /**
     * The number of indexed child variables.
     * The client can use this information to present the children in a paged UI and fetch them in chunks.
     */
    indexedVariables?: number;
    /**
     * A memory reference associated with this variable.
     * For pointer type variables, this is generally a reference to the memory address contained in the pointer.
     * For executable data, this reference may later be used in a `disassemble` request.
     * This attribute may be returned by a debug adapter if corresponding capability `supportsMemoryReferences` is true.
     */
    memoryReference?: string;
  };
  /**
   * Properties of a variable that can be used to determine how to render the variable in the UI.
   */
  export type VariablePresentationHint = {
    /**
     * The kind of variable. Before introducing additional values, try to use the listed values.
     */
    kind?: string;
    /**
     * Set of attributes represented as an array of strings. Before introducing additional values, try to use the listed values.
     */
    attributes?: string[];
    /**
     * Visibility of variable. Before introducing additional values, try to use the listed values.
     */
    visibility?: string;
    /**
     * If true, clients can present the variable with a UI that supports a specific gesture to trigger its evaluation.
     * This mechanism can be used for properties that require executing code when retrieving their value and where the code execution can be expensive and/or produce side-effects. A typical example are properties based on a getter function.
     * Please note that in addition to the `lazy` flag, the variable's `variablesReference` is expected to refer to a variable that will provide the value through another `variable` request.
     */
    lazy?: boolean;
  };
  /**
   * Properties of a breakpoint location returned from the `breakpointLocations` request.
   */
  export type BreakpointLocation = {
    /**
     * Start line of breakpoint location.
     */
    line: number;
    /**
     * The start position of a breakpoint location. Position is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: number;
    /**
     * The end line of breakpoint location if the location covers a range.
     */
    endLine?: number;
    /**
     * The end position of a breakpoint location (if the location covers a range). Position is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    endColumn?: number;
  };
  /**
   * Properties of a breakpoint or logpoint passed to the `setBreakpoints` request.
   */
  export type SourceBreakpoint = {
    /**
     * The source line of the breakpoint or logpoint.
     */
    line: number;
    /**
     * Start position within source line of the breakpoint or logpoint. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: number;
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
  };
  /**
   * Properties of a breakpoint passed to the `setFunctionBreakpoints` request.
   */
  export type FunctionBreakpoint = {
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
  };
  /**
   * This enumeration defines all possible access types for data breakpoints.
   */
  export type DataBreakpointAccessType = "read" | "write" | "readWrite";
  /**
   * Properties of a data breakpoint passed to the `setDataBreakpoints` request.
   */
  export type DataBreakpoint = {
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
  };
  /**
   * Properties of a breakpoint passed to the `setInstructionBreakpoints` request
   */
  export type InstructionBreakpoint = {
    /**
     * The instruction reference of the breakpoint.
     * This should be a memory or instruction pointer reference from an `EvaluateResponse`, `Variable`, `StackFrame`, `GotoTarget`, or `Breakpoint`.
     */
    instructionReference: string;
    /**
     * The offset from the instruction reference in bytes.
     * This can be negative.
     */
    offset?: number;
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
  };
  /**
   * Information about a breakpoint created in `setBreakpoints`, `setFunctionBreakpoints`, `setInstructionBreakpoints`, or `setDataBreakpoints` requests.
   */
  export type Breakpoint = {
    /**
     * The identifier for the breakpoint. It is needed if breakpoint events are used to update or remove breakpoints.
     */
    id?: number;
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
    line?: number;
    /**
     * Start position of the source range covered by the breakpoint. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: number;
    /**
     * The end line of the actual range covered by the breakpoint.
     */
    endLine?: number;
    /**
     * End position of the source range covered by the breakpoint. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     * If no end line is given, then the end column is assumed to be in the start line.
     */
    endColumn?: number;
    /**
     * A memory reference to where the breakpoint is set.
     */
    instructionReference?: string;
    /**
     * The offset from the instruction reference.
     * This can be negative.
     */
    offset?: number;
    /**
     * A machine-readable explanation of why a breakpoint may not be verified. If a breakpoint is verified or a specific reason is not known, the adapter should omit this property. Possible values include:
     *
     * - `pending`: Indicates a breakpoint might be verified in the future, but the adapter cannot verify it in the current state.
     * - `failed`: Indicates a breakpoint was not able to be verified, and the adapter does not believe it can be verified without intervention.
     */
    reason?: "pending" | "failed";
  };
  /**
   * The granularity of one 'step' in the stepping requests `next`, `stepIn`, `stepOut`, and `stepBack`.
   */
  export type SteppingGranularity = "statement" | "line" | "instruction";
  /**
   * A `StepInTarget` can be used in the `stepIn` request and determines into which single target the `stepIn` request should step.
   */
  export type StepInTarget = {
    /**
     * Unique identifier for a step-in target.
     */
    id: number;
    /**
     * The name of the step-in target (shown in the UI).
     */
    label: string;
    /**
     * The line of the step-in target.
     */
    line?: number;
    /**
     * Start position of the range covered by the step in target. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    column?: number;
    /**
     * The end line of the range covered by the step-in target.
     */
    endLine?: number;
    /**
     * End position of the range covered by the step in target. It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
     */
    endColumn?: number;
  };
  /**
   * A `GotoTarget` describes a code location that can be used as a target in the `goto` request.
   * The possible goto targets can be determined via the `gotoTargets` request.
   */
  export type GotoTarget = {
    /**
     * Unique identifier for a goto target. This is used in the `goto` request.
     */
    id: number;
    /**
     * The name of the goto target (shown in the UI).
     */
    label: string;
    /**
     * The line of the goto target.
     */
    line: number;
    /**
     * The column of the goto target.
     */
    column?: number;
    /**
     * The end line of the range covered by the goto target.
     */
    endLine?: number;
    /**
     * The end column of the range covered by the goto target.
     */
    endColumn?: number;
    /**
     * A memory reference for the instruction pointer value represented by this target.
     */
    instructionPointerReference?: string;
  };
  /**
   * `CompletionItems` are the suggestions returned from the `completions` request.
   */
  export type CompletionItem = {
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
    start?: number;
    /**
     * Length determines how many characters are overwritten by the completion text and it is measured in UTF-16 code units. If missing the value 0 is assumed which results in the completion text being inserted.
     */
    length?: number;
    /**
     * Determines the start of the new selection after the text has been inserted (or replaced). `selectionStart` is measured in UTF-16 code units and must be in the range 0 and length of the completion text. If omitted the selection starts at the end of the completion text.
     */
    selectionStart?: number;
    /**
     * Determines the length of the new selection after the text has been inserted (or replaced) and it is measured in UTF-16 code units. The selection can not extend beyond the bounds of the completion text. If omitted the length is assumed to be 0.
     */
    selectionLength?: number;
  };
  /**
   * Some predefined types for the CompletionItem. Please note that not all clients have specific icons for all of them.
   */
  export type CompletionItemType =
    | "method"
    | "function"
    | "constructor"
    | "field"
    | "variable"
    | "class"
    | "interface"
    | "module"
    | "property"
    | "unit"
    | "value"
    | "enum"
    | "keyword"
    | "snippet"
    | "text"
    | "color"
    | "file"
    | "reference"
    | "customcolor";
  /**
   * Names of checksum algorithms that may be supported by a debug adapter.
   */
  export type ChecksumAlgorithm = "MD5" | "SHA1" | "SHA256" | "timestamp";
  /**
   * The checksum of an item calculated by the specified algorithm.
   */
  export type Checksum = {
    /**
     * The algorithm used to calculate this checksum.
     */
    algorithm: ChecksumAlgorithm;
    /**
     * Value of the checksum, encoded as a hexadecimal value.
     */
    checksum: string;
  };
  /**
   * Provides formatting information for a value.
   */
  export type ValueFormat = {
    /**
     * Display the value in hex.
     */
    hex?: boolean;
  };
  export type StackFrameFormat = ValueFormat & {
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
  };
  /**
   * An `ExceptionFilterOptions` is used to specify an exception filter together with a condition for the `setExceptionBreakpoints` request.
   */
  export type ExceptionFilterOptions = {
    /**
     * ID of an exception filter returned by the `exceptionBreakpointFilters` capability.
     */
    filterId: string;
    /**
     * An expression for conditional exceptions.
     * The exception breaks into the debugger if the result of the condition is true.
     */
    condition?: string;
  };
  /**
   * An `ExceptionOptions` assigns configuration options to a set of exceptions.
   */
  export type ExceptionOptions = {
    /**
     * A path that selects a single or multiple exceptions in a tree. If `path` is missing, the whole tree is selected.
     * By convention the first segment of the path is a category that is used to group exceptions in the UI.
     */
    path?: ExceptionPathSegment[];
    /**
     * Condition when a thrown exception should result in a break.
     */
    breakMode: ExceptionBreakMode;
  };
  /**
   * This enumeration defines all possible conditions when a thrown exception should result in a break.
   * never: never breaks,
   * always: always breaks,
   * unhandled: breaks when exception unhandled,
   * userUnhandled: breaks if the exception is not handled by user code.
   */
  export type ExceptionBreakMode = "never" | "always" | "unhandled" | "userUnhandled";
  /**
   * An `ExceptionPathSegment` represents a segment in a path that is used to match leafs or nodes in a tree of exceptions.
   * If a segment consists of more than one name, it matches the names provided if `negate` is false or missing, or it matches anything except the names provided if `negate` is true.
   */
  export type ExceptionPathSegment = {
    /**
     * If false or missing this segment matches the names provided, otherwise it matches anything except the names provided.
     */
    negate?: boolean;
    /**
     * Depending on the value of `negate` the names that should match or not match.
     */
    names: string[];
  };
  /**
   * Detailed information about an exception that has occurred.
   */
  export type ExceptionDetails = {
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
  };
  /**
   * Represents a single disassembled instruction.
   */
  export type DisassembledInstruction = {
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
    line?: number;
    /**
     * The column within the line that corresponds to this instruction, if any.
     */
    column?: number;
    /**
     * The end line of the range that corresponds to this instruction, if any.
     */
    endLine?: number;
    /**
     * The end column of the range that corresponds to this instruction, if any.
     */
    endColumn?: number;
    /**
     * A hint for how to present the instruction in the UI.
     *
     * A value of `invalid` may be used to indicate this instruction is 'filler' and cannot be reached by the program. For example, unreadable memory addresses may be presented is 'invalid.'
     */
    presentationHint?: "normal" | "invalid";
  };
  /**
   * Logical areas that can be invalidated by the `invalidated` event.
   */
  export type InvalidatedAreas = string;
  export type ErrorRequest = {};
  export type ThreadsRequest = {};
  export type RequestMap = {
    cancel: CancelRequest;
    runInTerminal: RunInTerminalRequest;
    startDebugging: StartDebuggingRequest;
    initialize: InitializeRequest;
    configurationDone: ConfigurationDoneRequest;
    launch: LaunchRequest;
    attach: AttachRequest;
    restart: RestartRequest;
    disconnect: DisconnectRequest;
    terminate: TerminateRequest;
    breakpointLocations: BreakpointLocationsRequest;
    setBreakpoints: SetBreakpointsRequest;
    setFunctionBreakpoints: SetFunctionBreakpointsRequest;
    setExceptionBreakpoints: SetExceptionBreakpointsRequest;
    dataBreakpointInfo: DataBreakpointInfoRequest;
    setDataBreakpoints: SetDataBreakpointsRequest;
    setInstructionBreakpoints: SetInstructionBreakpointsRequest;
    continue: ContinueRequest;
    next: NextRequest;
    stepIn: StepInRequest;
    stepOut: StepOutRequest;
    stepBack: StepBackRequest;
    reverseContinue: ReverseContinueRequest;
    restartFrame: RestartFrameRequest;
    goto: GotoRequest;
    pause: PauseRequest;
    stackTrace: StackTraceRequest;
    scopes: ScopesRequest;
    variables: VariablesRequest;
    setVariable: SetVariableRequest;
    source: SourceRequest;
    terminateThreads: TerminateThreadsRequest;
    modules: ModulesRequest;
    loadedSources: LoadedSourcesRequest;
    evaluate: EvaluateRequest;
    setExpression: SetExpressionRequest;
    stepInTargets: StepInTargetsRequest;
    gotoTargets: GotoTargetsRequest;
    completions: CompletionsRequest;
    exceptionInfo: ExceptionInfoRequest;
    readMemory: ReadMemoryRequest;
    writeMemory: WriteMemoryRequest;
    disassemble: DisassembleRequest;
    error: ErrorRequest;
    threads: ThreadsRequest;
  };
  export type ResponseMap = {
    error: ErrorResponse;
    cancel: CancelResponse;
    runInTerminal: RunInTerminalResponse;
    startDebugging: StartDebuggingResponse;
    initialize: InitializeResponse;
    configurationDone: ConfigurationDoneResponse;
    launch: LaunchResponse;
    attach: AttachResponse;
    restart: RestartResponse;
    disconnect: DisconnectResponse;
    terminate: TerminateResponse;
    breakpointLocations: BreakpointLocationsResponse;
    setBreakpoints: SetBreakpointsResponse;
    setFunctionBreakpoints: SetFunctionBreakpointsResponse;
    setExceptionBreakpoints: SetExceptionBreakpointsResponse;
    dataBreakpointInfo: DataBreakpointInfoResponse;
    setDataBreakpoints: SetDataBreakpointsResponse;
    setInstructionBreakpoints: SetInstructionBreakpointsResponse;
    continue: ContinueResponse;
    next: NextResponse;
    stepIn: StepInResponse;
    stepOut: StepOutResponse;
    stepBack: StepBackResponse;
    reverseContinue: ReverseContinueResponse;
    restartFrame: RestartFrameResponse;
    goto: GotoResponse;
    pause: PauseResponse;
    stackTrace: StackTraceResponse;
    scopes: ScopesResponse;
    variables: VariablesResponse;
    setVariable: SetVariableResponse;
    source: SourceResponse;
    threads: ThreadsResponse;
    terminateThreads: TerminateThreadsResponse;
    modules: ModulesResponse;
    loadedSources: LoadedSourcesResponse;
    evaluate: EvaluateResponse;
    setExpression: SetExpressionResponse;
    stepInTargets: StepInTargetsResponse;
    gotoTargets: GotoTargetsResponse;
    completions: CompletionsResponse;
    exceptionInfo: ExceptionInfoResponse;
    readMemory: ReadMemoryResponse;
    writeMemory: WriteMemoryResponse;
    disassemble: DisassembleResponse;
  };
  export type EventMap = {
    initialized: InitializedEvent;
    stopped: StoppedEvent;
    continued: ContinuedEvent;
    exited: ExitedEvent;
    terminated: TerminatedEvent;
    thread: ThreadEvent;
    output: OutputEvent;
    breakpoint: BreakpointEvent;
    module: ModuleEvent;
    loadedSource: LoadedSourceEvent;
    process: ProcessEvent;
    capabilities: CapabilitiesEvent;
    progressStart: ProgressStartEvent;
    progressUpdate: ProgressUpdateEvent;
    progressEnd: ProgressEndEvent;
    invalidated: InvalidatedEvent;
    memory: MemoryEvent;
  };
}
