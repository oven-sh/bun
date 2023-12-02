// GENERATED - DO NOT EDIT
export namespace JSC {
  export namespace Console {
    /**
     * Channels for different types of log messages.
     */
    export type ChannelSource =
      | "xml"
      | "javascript"
      | "network"
      | "console-api"
      | "storage"
      | "appcache"
      | "rendering"
      | "css"
      | "security"
      | "content-blocker"
      | "media"
      | "mediasource"
      | "webrtc"
      | "itp-debug"
      | "private-click-measurement"
      | "payment-request"
      | "other";
    /**
     * Level of logging.
     */
    export type ChannelLevel = "off" | "basic" | "verbose";
    /**
     * The reason the console is being cleared.
     */
    export type ClearReason = "console-api" | "main-frame-navigation";
    /**
     * Logging channel.
     */
    export type Channel = {
      source: ChannelSource;
      level: ChannelLevel;
    };
    /**
     * Console message.
     */
    export type ConsoleMessage = {
      source: ChannelSource;
      /**
       * Message severity.
       */
      level: "log" | "info" | "warning" | "error" | "debug";
      /**
       * Message text.
       */
      text: string;
      /**
       * Console message type.
       */
      type?:
        | "log"
        | "dir"
        | "dirxml"
        | "table"
        | "trace"
        | "clear"
        | "startGroup"
        | "startGroupCollapsed"
        | "endGroup"
        | "assert"
        | "timing"
        | "profile"
        | "profileEnd"
        | "image"
        | undefined;
      /**
       * URL of the message origin.
       */
      url?: string | undefined;
      /**
       * Line number in the resource that generated this message.
       */
      line?: number | undefined;
      /**
       * Column number on the line in the resource that generated this message.
       */
      column?: number | undefined;
      /**
       * Repeat count for repeated messages.
       */
      repeatCount?: number | undefined;
      /**
       * Message parameters in case of the formatted message.
       */
      parameters?: Runtime.RemoteObject[] | undefined;
      /**
       * JavaScript stack trace for assertions and error messages.
       */
      stackTrace?: StackTrace | undefined;
      /**
       * Identifier of the network request associated with this message.
       */
      networkRequestId?: Network.RequestId | undefined;
      /**
       * Time when this message was added. Currently only used when an expensive operation happens to make sure that the frontend can account for it.
       */
      timestamp?: number | undefined;
    };
    /**
     * Stack entry for console errors and assertions.
     */
    export type CallFrame = {
      /**
       * JavaScript function name.
       */
      functionName: string;
      /**
       * JavaScript script name or url.
       */
      url: string;
      /**
       * Script identifier.
       */
      scriptId: Debugger.ScriptId;
      /**
       * JavaScript script line number.
       */
      lineNumber: number;
      /**
       * JavaScript script column number.
       */
      columnNumber: number;
    };
    /**
     * Call frames for async function calls, console assertions, and error messages.
     */
    export type StackTrace = {
      callFrames: CallFrame[];
      /**
       * Whether the first item in <code>callFrames</code> is the native function that scheduled the asynchronous operation (e.g. setTimeout).
       */
      topCallFrameIsBoundary?: boolean | undefined;
      /**
       * Whether one or more frames have been truncated from the bottom of the stack.
       */
      truncated?: boolean | undefined;
      /**
       * Parent StackTrace.
       */
      parentStackTrace?: StackTrace | undefined;
    };
    /**
     * Issued when new console message is added.
     * @event `Console.messageAdded`
     */
    export type MessageAddedEvent = {
      /**
       * Console message that has been added.
       */
      message: ConsoleMessage;
    };
    /**
     * Issued when subsequent message(s) are equal to the previous one(s).
     * @event `Console.messageRepeatCountUpdated`
     */
    export type MessageRepeatCountUpdatedEvent = {
      /**
       * New repeat count value.
       */
      count: number;
      /**
       * Timestamp of the latest message.
       */
      timestamp?: number | undefined;
    };
    /**
     * Issued when console is cleared. This happens either upon <code>clearMessages</code> command or after page navigation.
     * @event `Console.messagesCleared`
     */
    export type MessagesClearedEvent = {
      /**
       * The reason the console is being cleared.
       */
      reason: ClearReason;
    };
    /**
     * Issued from console.takeHeapSnapshot.
     * @event `Console.heapSnapshot`
     */
    export type HeapSnapshotEvent = {
      timestamp: number;
      /**
       * Snapshot at the end of tracking.
       */
      snapshotData: Heap.HeapSnapshotData;
      /**
       * Optional title provided to console.takeHeapSnapshot.
       */
      title?: string | undefined;
    };
    /**
     * Enables console domain, sends the messages collected so far to the client by means of the <code>messageAdded</code> notification.
     * @request `Console.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables console domain, sends the messages collected so far to the client by means of the <code>messageAdded</code> notification.
     * @response `Console.enable`
     */
    export type EnableResponse = {};
    /**
     * Disables console domain, prevents further console messages from being reported to the client.
     * @request `Console.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables console domain, prevents further console messages from being reported to the client.
     * @response `Console.disable`
     */
    export type DisableResponse = {};
    /**
     * Clears console messages collected in the browser.
     * @request `Console.clearMessages`
     */
    export type ClearMessagesRequest = {};
    /**
     * Clears console messages collected in the browser.
     * @response `Console.clearMessages`
     */
    export type ClearMessagesResponse = {};
    /**
     * List of the different message sources that are non-default logging channels.
     * @request `Console.getLoggingChannels`
     */
    export type GetLoggingChannelsRequest = {};
    /**
     * List of the different message sources that are non-default logging channels.
     * @response `Console.getLoggingChannels`
     */
    export type GetLoggingChannelsResponse = {
      /**
       * Logging channels.
       */
      channels: Channel[];
    };
    /**
     * Modify the level of a channel.
     * @request `Console.setLoggingChannelLevel`
     */
    export type SetLoggingChannelLevelRequest = {
      /**
       * Logging channel to modify.
       */
      source: ChannelSource;
      /**
       * New level.
       */
      level: ChannelLevel;
    };
    /**
     * Modify the level of a channel.
     * @response `Console.setLoggingChannelLevel`
     */
    export type SetLoggingChannelLevelResponse = {};
  }
  export namespace CPUProfiler {
    /**
     * CPU usage for an individual thread.
     */
    export type ThreadInfo = {
      /**
       * Some thread identification information.
       */
      name: string;
      /**
       * CPU usage for this thread. This should not exceed 100% for an individual thread.
       */
      usage: number;
      /**
       * Type of thread. There should be a single main thread.
       */
      type?: "main" | "webkit" | undefined;
      /**
       * A thread may be associated with a target, such as a Worker, in the process.
       */
      targetId?: string | undefined;
    };
    export type Event = {
      timestamp: number;
      /**
       * Percent of total cpu usage. If there are multiple cores the usage may be greater than 100%.
       */
      usage: number;
      /**
       * Per-thread CPU usage information. Does not include the main thread.
       */
      threads?: ThreadInfo[] | undefined;
    };
    /**
     * Tracking started.
     * @event `CPUProfiler.trackingStart`
     */
    export type TrackingStartEvent = {
      timestamp: number;
    };
    /**
     * Periodic tracking updates with event data.
     * @event `CPUProfiler.trackingUpdate`
     */
    export type TrackingUpdateEvent = {
      event: Event;
    };
    /**
     * Tracking stopped.
     * @event `CPUProfiler.trackingComplete`
     */
    export type TrackingCompleteEvent = {
      timestamp: number;
    };
    /**
     * Start tracking cpu usage.
     * @request `CPUProfiler.startTracking`
     */
    export type StartTrackingRequest = {};
    /**
     * Start tracking cpu usage.
     * @response `CPUProfiler.startTracking`
     */
    export type StartTrackingResponse = {};
    /**
     * Stop tracking cpu usage. This will produce a `trackingComplete` event.
     * @request `CPUProfiler.stopTracking`
     */
    export type StopTrackingRequest = {};
    /**
     * Stop tracking cpu usage. This will produce a `trackingComplete` event.
     * @response `CPUProfiler.stopTracking`
     */
    export type StopTrackingResponse = {};
  }
  export namespace Debugger {
    /**
     * Breakpoint identifier.
     */
    export type BreakpointId = string;
    /**
     * Breakpoint action identifier.
     */
    export type BreakpointActionIdentifier = number;
    /**
     * Unique script identifier.
     */
    export type ScriptId = string;
    /**
     * Call frame identifier.
     */
    export type CallFrameId = string;
    /**
     * Location in the source code.
     */
    export type Location = {
      /**
       * Script identifier as reported in the <code>Debugger.scriptParsed</code>.
       */
      scriptId: ScriptId;
      /**
       * Line number in the script (0-based).
       */
      lineNumber: number;
      /**
       * Column number in the script (0-based).
       */
      columnNumber?: number | undefined;
    };
    /**
     * Action to perform when a breakpoint is triggered.
     */
    export type BreakpointAction = {
      /**
       * Different kinds of breakpoint actions.
       */
      type: "log" | "evaluate" | "sound" | "probe";
      /**
       * Data associated with this breakpoint type (e.g. for type "eval" this is the JavaScript string to evaluate).
       */
      data?: string | undefined;
      /**
       * A frontend-assigned identifier for this breakpoint action.
       */
      id?: BreakpointActionIdentifier | undefined;
      /**
       * Indicates whether this action should be executed with a user gesture or not. Defaults to <code>false<code>.
       */
      emulateUserGesture?: boolean | undefined;
    };
    /**
     * Extra options that modify breakpoint behavior.
     */
    export type BreakpointOptions = {
      /**
       * Expression to use as a breakpoint condition. When specified, debugger will only stop on the breakpoint if this expression evaluates to true.
       */
      condition?: string | undefined;
      /**
       * Actions to perform automatically when the breakpoint is triggered.
       */
      actions?: BreakpointAction[] | undefined;
      /**
       * Automatically continue after hitting this breakpoint and running actions.
       */
      autoContinue?: boolean | undefined;
      /**
       * Number of times to ignore this breakpoint, before stopping on the breakpoint and running actions.
       */
      ignoreCount?: number | undefined;
    };
    /**
     * Information about the function.
     */
    export type FunctionDetails = {
      /**
       * Location of the function.
       */
      location: Location;
      /**
       * Name of the function. Not present for anonymous functions.
       */
      name?: string | undefined;
      /**
       * Display name of the function(specified in 'displayName' property on the function object).
       */
      displayName?: string | undefined;
      /**
       * Scope chain for this closure.
       */
      scopeChain?: Scope[] | undefined;
    };
    /**
     * JavaScript call frame. Array of call frames form the call stack.
     */
    export type CallFrame = {
      /**
       * Call frame identifier. This identifier is only valid while the virtual machine is paused.
       */
      callFrameId: CallFrameId;
      /**
       * Name of the JavaScript function called on this call frame.
       */
      functionName: string;
      /**
       * Location in the source code.
       */
      location: Location;
      /**
       * Scope chain for this call frame.
       */
      scopeChain: Scope[];
      /**
       * <code>this</code> object for this call frame.
       */
      this: Runtime.RemoteObject;
      /**
       * Is the current frame tail deleted from a tail call.
       */
      isTailDeleted: boolean;
    };
    /**
     * Scope description.
     */
    export type Scope = {
      /**
       * Object representing the scope. For <code>global</code> and <code>with</code> scopes it represents the actual object; for the rest of the scopes, it is artificial transient object enumerating scope variables as its properties.
       */
      object: Runtime.RemoteObject;
      /**
       * Scope type.
       */
      type: "global" | "with" | "closure" | "catch" | "functionName" | "globalLexicalEnvironment" | "nestedLexical";
      /**
       * Name associated with the scope.
       */
      name?: string | undefined;
      /**
       * Location if available of the scope definition.
       */
      location?: Location | undefined;
      /**
       * Whether the scope has any variables.
       */
      empty?: boolean | undefined;
    };
    /**
     * A sample collected by evaluating a probe breakpoint action.
     */
    export type ProbeSample = {
      /**
       * Identifier of the probe breakpoint action that created the sample.
       */
      probeId: BreakpointActionIdentifier;
      /**
       * Unique identifier for this sample.
       */
      sampleId: number;
      /**
       * A batch identifier which is the same for all samples taken at the same breakpoint hit.
       */
      batchId: number;
      /**
       * Timestamp of when the sample was taken.
       */
      timestamp: number;
      /**
       * Contents of the sample.
       */
      payload: Runtime.RemoteObject;
    };
    /**
     * The pause reason auxiliary data when paused because of an assertion.
     */
    export type AssertPauseReason = {
      /**
       * The console.assert message string if provided.
       */
      message?: string | undefined;
    };
    /**
     * The pause reason auxiliary data when paused because of hitting a breakpoint.
     */
    export type BreakpointPauseReason = {
      /**
       * The identifier of the breakpoint causing the pause.
       */
      breakpointId: string;
    };
    /**
     * The pause reason auxiliary data when paused because of a Content Security Policy directive.
     */
    export type CSPViolationPauseReason = {
      /**
       * The CSP directive that blocked script execution.
       */
      directive: string;
    };
    /**
     * Called when global has been cleared and debugger client should reset its state. Happens upon navigation or reload.
     * @event `Debugger.globalObjectCleared`
     */
    export type GlobalObjectClearedEvent = {};
    /**
     * Fired when virtual machine parses script. This event is also fired for all known and uncollected scripts upon enabling debugger.
     * @event `Debugger.scriptParsed`
     */
    export type ScriptParsedEvent = {
      /**
       * Identifier of the script parsed.
       */
      scriptId: ScriptId;
      /**
       * URL of the script parsed (if any).
       */
      url: string;
      /**
       * Line offset of the script within the resource with given URL (for script tags).
       */
      startLine: number;
      /**
       * Column offset of the script within the resource with given URL.
       */
      startColumn: number;
      /**
       * Last line of the script.
       */
      endLine: number;
      /**
       * Length of the last line of the script.
       */
      endColumn: number;
      /**
       * Determines whether this script is a user extension script.
       */
      isContentScript?: boolean | undefined;
      /**
       * sourceURL name of the script (if any).
       */
      sourceURL?: string | undefined;
      /**
       * URL of source map associated with script (if any).
       */
      sourceMapURL?: string | undefined;
      /**
       * True if this script was parsed as a module.
       */
      module?: boolean | undefined;
    };
    /**
     * Fired when virtual machine fails to parse the script.
     * @event `Debugger.scriptFailedToParse`
     */
    export type ScriptFailedToParseEvent = {
      /**
       * URL of the script that failed to parse.
       */
      url: string;
      /**
       * Source text of the script that failed to parse.
       */
      scriptSource: string;
      /**
       * Line offset of the script within the resource.
       */
      startLine: number;
      /**
       * Line with error.
       */
      errorLine: number;
      /**
       * Parse error message.
       */
      errorMessage: string;
    };
    /**
     * Fired when breakpoint is resolved to an actual script and location.
     * @event `Debugger.breakpointResolved`
     */
    export type BreakpointResolvedEvent = {
      /**
       * Breakpoint unique identifier.
       */
      breakpointId: BreakpointId;
      /**
       * Actual breakpoint location.
       */
      location: Location;
    };
    /**
     * Fired when the virtual machine stopped on breakpoint or exception or any other stop criteria.
     * @event `Debugger.paused`
     */
    export type PausedEvent = {
      /**
       * Call stack the virtual machine stopped on.
       */
      callFrames: CallFrame[];
      /**
       * Pause reason.
       */
      reason:
        | "URL"
        | "DOM"
        | "AnimationFrame"
        | "Interval"
        | "Listener"
        | "Timeout"
        | "exception"
        | "assert"
        | "CSPViolation"
        | "DebuggerStatement"
        | "Breakpoint"
        | "PauseOnNextStatement"
        | "Microtask"
        | "FunctionCall"
        | "BlackboxedScript"
        | "other";
      /**
       * Object containing break-specific auxiliary properties.
       */
      data?: Record<string, unknown> | undefined;
      /**
       * Linked list of asynchronous StackTraces.
       */
      asyncStackTrace?: Console.StackTrace | undefined;
    };
    /**
     * Fired when the virtual machine resumed execution.
     * @event `Debugger.resumed`
     */
    export type ResumedEvent = {};
    /**
     * Fires when a new probe sample is collected.
     * @event `Debugger.didSampleProbe`
     */
    export type DidSampleProbeEvent = {
      /**
       * A collected probe sample.
       */
      sample: ProbeSample;
    };
    /**
     * Fired when a "sound" breakpoint action is triggered on a breakpoint.
     * @event `Debugger.playBreakpointActionSound`
     */
    export type PlayBreakpointActionSoundEvent = {
      /**
       * Breakpoint action identifier.
       */
      breakpointActionId: BreakpointActionIdentifier;
    };
    /**
     * Enables debugger for the given page. Clients should not assume that the debugging has been enabled until the result for this command is received.
     * @request `Debugger.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables debugger for the given page. Clients should not assume that the debugging has been enabled until the result for this command is received.
     * @response `Debugger.enable`
     */
    export type EnableResponse = {};
    /**
     * Disables debugger for given page.
     * @request `Debugger.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables debugger for given page.
     * @response `Debugger.disable`
     */
    export type DisableResponse = {};
    /**
     * Set the async stack trace depth for the page. A value of zero disables recording of async stack traces.
     * @request `Debugger.setAsyncStackTraceDepth`
     */
    export type SetAsyncStackTraceDepthRequest = {
      /**
       * Async stack trace depth.
       */
      depth: number;
    };
    /**
     * Set the async stack trace depth for the page. A value of zero disables recording of async stack traces.
     * @response `Debugger.setAsyncStackTraceDepth`
     */
    export type SetAsyncStackTraceDepthResponse = {};
    /**
     * Activates / deactivates all breakpoints on the page.
     * @request `Debugger.setBreakpointsActive`
     */
    export type SetBreakpointsActiveRequest = {
      /**
       * New value for breakpoints active state.
       */
      active: boolean;
    };
    /**
     * Activates / deactivates all breakpoints on the page.
     * @response `Debugger.setBreakpointsActive`
     */
    export type SetBreakpointsActiveResponse = {};
    /**
     * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this command is issued, all existing parsed scripts will have breakpoints resolved and returned in <code>locations</code> property. Further matching script parsing will result in subsequent <code>breakpointResolved</code> events issued. This logical breakpoint will survive page reloads.
     * @request `Debugger.setBreakpointByUrl`
     */
    export type SetBreakpointByUrlRequest = {
      /**
       * Line number to set breakpoint at.
       */
      lineNumber: number;
      /**
       * URL of the resources to set breakpoint on.
       */
      url?: string | undefined;
      /**
       * Regex pattern for the URLs of the resources to set breakpoints on. Either <code>url</code> or <code>urlRegex</code> must be specified.
       */
      urlRegex?: string | undefined;
      /**
       * Offset in the line to set breakpoint at.
       */
      columnNumber?: number | undefined;
      /**
       * Options to apply to this breakpoint to modify its behavior.
       */
      options?: BreakpointOptions | undefined;
    };
    /**
     * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this command is issued, all existing parsed scripts will have breakpoints resolved and returned in <code>locations</code> property. Further matching script parsing will result in subsequent <code>breakpointResolved</code> events issued. This logical breakpoint will survive page reloads.
     * @response `Debugger.setBreakpointByUrl`
     */
    export type SetBreakpointByUrlResponse = {
      /**
       * Id of the created breakpoint for further reference.
       */
      breakpointId: BreakpointId;
      /**
       * List of the locations this breakpoint resolved into upon addition.
       */
      locations: Location[];
    };
    /**
     * Sets JavaScript breakpoint at a given location.
     * @request `Debugger.setBreakpoint`
     */
    export type SetBreakpointRequest = {
      /**
       * Location to set breakpoint in.
       */
      location: Location;
      /**
       * Options to apply to this breakpoint to modify its behavior.
       */
      options?: BreakpointOptions | undefined;
    };
    /**
     * Sets JavaScript breakpoint at a given location.
     * @response `Debugger.setBreakpoint`
     */
    export type SetBreakpointResponse = {
      /**
       * Id of the created breakpoint for further reference.
       */
      breakpointId: BreakpointId;
      /**
       * Location this breakpoint resolved into.
       */
      actualLocation: Location;
    };
    /**
     * Removes JavaScript breakpoint.
     * @request `Debugger.removeBreakpoint`
     */
    export type RemoveBreakpointRequest = {
      breakpointId: BreakpointId;
    };
    /**
     * Removes JavaScript breakpoint.
     * @response `Debugger.removeBreakpoint`
     */
    export type RemoveBreakpointResponse = {};
    /**
     * Adds a JavaScript breakpoint that pauses execution whenever a function with the given name is about to be called.
     * @request `Debugger.addSymbolicBreakpoint`
     */
    export type AddSymbolicBreakpointRequest = {
      /**
       * The name of the function to pause in when called.
       */
      symbol: string;
      /**
       * If true, symbol is case sensitive. Defaults to true.
       */
      caseSensitive?: boolean | undefined;
      /**
       * If true, treats symbol as a regex. Defaults to false.
       */
      isRegex?: boolean | undefined;
      /**
       * Options to apply to this breakpoint to modify its behavior.
       */
      options?: BreakpointOptions | undefined;
    };
    /**
     * Adds a JavaScript breakpoint that pauses execution whenever a function with the given name is about to be called.
     * @response `Debugger.addSymbolicBreakpoint`
     */
    export type AddSymbolicBreakpointResponse = {};
    /**
     * Removes a previously added symbolic breakpoint.
     * @request `Debugger.removeSymbolicBreakpoint`
     */
    export type RemoveSymbolicBreakpointRequest = {
      /**
       * The name of the function to pause in when called.
       */
      symbol: string;
      /**
       * If true, symbol is case sensitive. Defaults to true.
       */
      caseSensitive?: boolean | undefined;
      /**
       * If true, treats symbol as a regex. Defaults to false.
       */
      isRegex?: boolean | undefined;
    };
    /**
     * Removes a previously added symbolic breakpoint.
     * @response `Debugger.removeSymbolicBreakpoint`
     */
    export type RemoveSymbolicBreakpointResponse = {};
    /**
     * Continues execution until the current evaluation completes. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @request `Debugger.continueUntilNextRunLoop`
     */
    export type ContinueUntilNextRunLoopRequest = {};
    /**
     * Continues execution until the current evaluation completes. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @response `Debugger.continueUntilNextRunLoop`
     */
    export type ContinueUntilNextRunLoopResponse = {};
    /**
     * Continues execution until specific location is reached. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @request `Debugger.continueToLocation`
     */
    export type ContinueToLocationRequest = {
      /**
       * Location to continue to.
       */
      location: Location;
    };
    /**
     * Continues execution until specific location is reached. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @response `Debugger.continueToLocation`
     */
    export type ContinueToLocationResponse = {};
    /**
     * Steps over the expression. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @request `Debugger.stepNext`
     */
    export type StepNextRequest = {};
    /**
     * Steps over the expression. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @response `Debugger.stepNext`
     */
    export type StepNextResponse = {};
    /**
     * Steps over the statement. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @request `Debugger.stepOver`
     */
    export type StepOverRequest = {};
    /**
     * Steps over the statement. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @response `Debugger.stepOver`
     */
    export type StepOverResponse = {};
    /**
     * Steps into the function call. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @request `Debugger.stepInto`
     */
    export type StepIntoRequest = {};
    /**
     * Steps into the function call. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @response `Debugger.stepInto`
     */
    export type StepIntoResponse = {};
    /**
     * Steps out of the function call. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @request `Debugger.stepOut`
     */
    export type StepOutRequest = {};
    /**
     * Steps out of the function call. This will trigger either a Debugger.paused or Debugger.resumed event.
     * @response `Debugger.stepOut`
     */
    export type StepOutResponse = {};
    /**
     * Stops on the next JavaScript statement.
     * @request `Debugger.pause`
     */
    export type PauseRequest = {};
    /**
     * Stops on the next JavaScript statement.
     * @response `Debugger.pause`
     */
    export type PauseResponse = {};
    /**
     * Resumes JavaScript execution. This will trigger a Debugger.resumed event.
     * @request `Debugger.resume`
     */
    export type ResumeRequest = {};
    /**
     * Resumes JavaScript execution. This will trigger a Debugger.resumed event.
     * @response `Debugger.resume`
     */
    export type ResumeResponse = {};
    /**
     * Searches for given string in script content.
     * @request `Debugger.searchInContent`
     */
    export type SearchInContentRequest = {
      /**
       * Id of the script to search in.
       */
      scriptId: ScriptId;
      /**
       * String to search for.
       */
      query: string;
      /**
       * If true, search is case sensitive.
       */
      caseSensitive?: boolean | undefined;
      /**
       * If true, treats string parameter as regex.
       */
      isRegex?: boolean | undefined;
    };
    /**
     * Searches for given string in script content.
     * @response `Debugger.searchInContent`
     */
    export type SearchInContentResponse = {
      /**
       * List of search matches.
       */
      result: GenericTypes.SearchMatch[];
    };
    /**
     * Returns source for the script with given id.
     * @request `Debugger.getScriptSource`
     */
    export type GetScriptSourceRequest = {
      /**
       * Id of the script to get source for.
       */
      scriptId: ScriptId;
    };
    /**
     * Returns source for the script with given id.
     * @response `Debugger.getScriptSource`
     */
    export type GetScriptSourceResponse = {
      /**
       * Script source.
       */
      scriptSource: string;
    };
    /**
     * Returns detailed information on given function.
     * @request `Debugger.getFunctionDetails`
     */
    export type GetFunctionDetailsRequest = {
      /**
       * Id of the function to get location for.
       */
      functionId: Runtime.RemoteObjectId;
    };
    /**
     * Returns detailed information on given function.
     * @response `Debugger.getFunctionDetails`
     */
    export type GetFunctionDetailsResponse = {
      /**
       * Information about the function.
       */
      details: FunctionDetails;
    };
    /**
     * Returns a list of valid breakpoint locations within the given location range.
     * @request `Debugger.getBreakpointLocations`
     */
    export type GetBreakpointLocationsRequest = {
      /**
       * Starting location to look for breakpoint locations after (inclusive). Must have same scriptId as end.
       */
      start: Location;
      /**
       * Ending location to look for breakpoint locations before (exclusive). Must have same scriptId as start.
       */
      end: Location;
    };
    /**
     * Returns a list of valid breakpoint locations within the given location range.
     * @response `Debugger.getBreakpointLocations`
     */
    export type GetBreakpointLocationsResponse = {
      /**
       * List of resolved breakpoint locations.
       */
      locations: Location[];
    };
    /**
     * Control whether the debugger pauses execution before `debugger` statements.
     * @request `Debugger.setPauseOnDebuggerStatements`
     */
    export type SetPauseOnDebuggerStatementsRequest = {
      enabled: boolean;
      /**
       * Options to apply to this breakpoint to modify its behavior.
       */
      options?: BreakpointOptions | undefined;
    };
    /**
     * Control whether the debugger pauses execution before `debugger` statements.
     * @response `Debugger.setPauseOnDebuggerStatements`
     */
    export type SetPauseOnDebuggerStatementsResponse = {};
    /**
     * Defines pause on exceptions state. Can be set to stop on all exceptions, uncaught exceptions or no exceptions. Initial pause on exceptions state is <code>none</code>.
     * @request `Debugger.setPauseOnExceptions`
     */
    export type SetPauseOnExceptionsRequest = {
      /**
       * Pause on exceptions mode.
       */
      state: "none" | "uncaught" | "all";
      /**
       * Options to apply to this breakpoint to modify its behavior.
       */
      options?: BreakpointOptions | undefined;
    };
    /**
     * Defines pause on exceptions state. Can be set to stop on all exceptions, uncaught exceptions or no exceptions. Initial pause on exceptions state is <code>none</code>.
     * @response `Debugger.setPauseOnExceptions`
     */
    export type SetPauseOnExceptionsResponse = {};
    /**
     * Set pause on assertions state. Assertions are console.assert assertions.
     * @request `Debugger.setPauseOnAssertions`
     */
    export type SetPauseOnAssertionsRequest = {
      enabled: boolean;
      /**
       * Options to apply to this breakpoint to modify its behavior.
       */
      options?: BreakpointOptions | undefined;
    };
    /**
     * Set pause on assertions state. Assertions are console.assert assertions.
     * @response `Debugger.setPauseOnAssertions`
     */
    export type SetPauseOnAssertionsResponse = {};
    /**
     * Pause when running the next JavaScript microtask.
     * @request `Debugger.setPauseOnMicrotasks`
     */
    export type SetPauseOnMicrotasksRequest = {
      enabled: boolean;
      /**
       * Options to apply to this breakpoint to modify its behavior.
       */
      options?: BreakpointOptions | undefined;
    };
    /**
     * Pause when running the next JavaScript microtask.
     * @response `Debugger.setPauseOnMicrotasks`
     */
    export type SetPauseOnMicrotasksResponse = {};
    /**
     * Change whether to pause in the debugger for internal scripts. The default value is false.
     * @request `Debugger.setPauseForInternalScripts`
     */
    export type SetPauseForInternalScriptsRequest = {
      shouldPause: boolean;
    };
    /**
     * Change whether to pause in the debugger for internal scripts. The default value is false.
     * @response `Debugger.setPauseForInternalScripts`
     */
    export type SetPauseForInternalScriptsResponse = {};
    /**
     * Evaluates expression on a given call frame.
     * @request `Debugger.evaluateOnCallFrame`
     */
    export type EvaluateOnCallFrameRequest = {
      /**
       * Call frame identifier to evaluate on.
       */
      callFrameId: CallFrameId;
      /**
       * Expression to evaluate.
       */
      expression: string;
      /**
       * String object group name to put result into (allows rapid releasing resulting object handles using <code>releaseObjectGroup</code>).
       */
      objectGroup?: string | undefined;
      /**
       * Specifies whether command line API should be available to the evaluated expression, defaults to false.
       */
      includeCommandLineAPI?: boolean | undefined;
      /**
       * Specifies whether evaluation should stop on exceptions and mute console. Overrides setPauseOnException state.
       */
      doNotPauseOnExceptionsAndMuteConsole?: boolean | undefined;
      /**
       * Whether the result is expected to be a JSON object that should be sent by value.
       */
      returnByValue?: boolean | undefined;
      /**
       * Whether preview should be generated for the result.
       */
      generatePreview?: boolean | undefined;
      /**
       * Whether the resulting value should be considered for saving in the $n history.
       */
      saveResult?: boolean | undefined;
      /**
       * Whether the expression should be considered to be in a user gesture or not.
       */
      emulateUserGesture?: boolean | undefined;
    };
    /**
     * Evaluates expression on a given call frame.
     * @response `Debugger.evaluateOnCallFrame`
     */
    export type EvaluateOnCallFrameResponse = {
      /**
       * Object wrapper for the evaluation result.
       */
      result: Runtime.RemoteObject;
      /**
       * True if the result was thrown during the evaluation.
       */
      wasThrown?: boolean | undefined;
      /**
       * If the result was saved, this is the $n index that can be used to access the value.
       */
      savedResultIndex?: number | undefined;
    };
    /**
     * Sets whether the given URL should be in the list of blackboxed scripts, which are ignored when pausing/stepping/debugging.
     * @request `Debugger.setShouldBlackboxURL`
     */
    export type SetShouldBlackboxURLRequest = {
      url: string;
      shouldBlackbox: boolean;
      /**
       * If true, <code>url</code> is case sensitive.
       */
      caseSensitive?: boolean | undefined;
      /**
       * If true, treat <code>url</code> as regular expression.
       */
      isRegex?: boolean | undefined;
    };
    /**
     * Sets whether the given URL should be in the list of blackboxed scripts, which are ignored when pausing/stepping/debugging.
     * @response `Debugger.setShouldBlackboxURL`
     */
    export type SetShouldBlackboxURLResponse = {};
    /**
     * Sets whether evaluation of breakpoint conditions, ignore counts, and actions happen at the location of the breakpoint or are deferred due to blackboxing.
     * @request `Debugger.setBlackboxBreakpointEvaluations`
     */
    export type SetBlackboxBreakpointEvaluationsRequest = {
      blackboxBreakpointEvaluations: boolean;
    };
    /**
     * Sets whether evaluation of breakpoint conditions, ignore counts, and actions happen at the location of the breakpoint or are deferred due to blackboxing.
     * @response `Debugger.setBlackboxBreakpointEvaluations`
     */
    export type SetBlackboxBreakpointEvaluationsResponse = {};
  }
  export namespace GenericTypes {
    /**
     * Search match in a resource.
     */
    export type SearchMatch = {
      /**
       * Line number in resource content.
       */
      lineNumber: number;
      /**
       * Line with match content.
       */
      lineContent: string;
    };
  }
  export namespace Heap {
    /**
     * Information about a garbage collection.
     */
    export type GarbageCollection = {
      /**
       * The type of garbage collection.
       */
      type: "full" | "partial";
      startTime: number;
      endTime: number;
    };
    /**
     * JavaScriptCore HeapSnapshot JSON data.
     */
    export type HeapSnapshotData = string;
    /**
     * Information about the garbage collection.
     * @event `Heap.garbageCollected`
     */
    export type GarbageCollectedEvent = {
      collection: GarbageCollection;
    };
    /**
     * Tracking started.
     * @event `Heap.trackingStart`
     */
    export type TrackingStartEvent = {
      timestamp: number;
      /**
       * Snapshot at the start of tracking.
       */
      snapshotData: HeapSnapshotData;
    };
    /**
     * Tracking stopped.
     * @event `Heap.trackingComplete`
     */
    export type TrackingCompleteEvent = {
      timestamp: number;
      /**
       * Snapshot at the end of tracking.
       */
      snapshotData: HeapSnapshotData;
    };
    /**
     * Enables Heap domain events.
     * @request `Heap.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables Heap domain events.
     * @response `Heap.enable`
     */
    export type EnableResponse = {};
    /**
     * Disables Heap domain events.
     * @request `Heap.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables Heap domain events.
     * @response `Heap.disable`
     */
    export type DisableResponse = {};
    /**
     * Trigger a full garbage collection.
     * @request `Heap.gc`
     */
    export type GcRequest = {};
    /**
     * Trigger a full garbage collection.
     * @response `Heap.gc`
     */
    export type GcResponse = {};
    /**
     * Take a heap snapshot.
     * @request `Heap.snapshot`
     */
    export type SnapshotRequest = {};
    /**
     * Take a heap snapshot.
     * @response `Heap.snapshot`
     */
    export type SnapshotResponse = {
      timestamp: number;
      snapshotData: HeapSnapshotData;
    };
    /**
     * Start tracking heap changes. This will produce a `trackingStart` event.
     * @request `Heap.startTracking`
     */
    export type StartTrackingRequest = {};
    /**
     * Start tracking heap changes. This will produce a `trackingStart` event.
     * @response `Heap.startTracking`
     */
    export type StartTrackingResponse = {};
    /**
     * Stop tracking heap changes. This will produce a `trackingComplete` event.
     * @request `Heap.stopTracking`
     */
    export type StopTrackingRequest = {};
    /**
     * Stop tracking heap changes. This will produce a `trackingComplete` event.
     * @response `Heap.stopTracking`
     */
    export type StopTrackingResponse = {};
    /**
     * Returns a preview (string, Debugger.FunctionDetails, or Runtime.ObjectPreview) for a Heap.HeapObjectId.
     * @request `Heap.getPreview`
     */
    export type GetPreviewRequest = {
      /**
       * Identifier of the heap object within the snapshot.
       */
      heapObjectId: number;
    };
    /**
     * Returns a preview (string, Debugger.FunctionDetails, or Runtime.ObjectPreview) for a Heap.HeapObjectId.
     * @response `Heap.getPreview`
     */
    export type GetPreviewResponse = {
      /**
       * String value.
       */
      string?: string | undefined;
      /**
       * Function details.
       */
      functionDetails?: Debugger.FunctionDetails | undefined;
      /**
       * Object preview.
       */
      preview?: Runtime.ObjectPreview | undefined;
    };
    /**
     * Returns the strongly referenced Runtime.RemoteObject for a Heap.HeapObjectId.
     * @request `Heap.getRemoteObject`
     */
    export type GetRemoteObjectRequest = {
      /**
       * Identifier of the heap object within the snapshot.
       */
      heapObjectId: number;
      /**
       * Symbolic group name that can be used to release multiple objects.
       */
      objectGroup?: string | undefined;
    };
    /**
     * Returns the strongly referenced Runtime.RemoteObject for a Heap.HeapObjectId.
     * @response `Heap.getRemoteObject`
     */
    export type GetRemoteObjectResponse = {
      /**
       * Resulting object.
       */
      result: Runtime.RemoteObject;
    };
  }
  export namespace Inspector {
    /**
     * undefined
     * @event `Inspector.evaluateForTestInFrontend`
     */
    export type EvaluateForTestInFrontendEvent = {
      script: string;
    };
    /**
     * undefined
     * @event `Inspector.inspect`
     */
    export type InspectEvent = {
      object: Runtime.RemoteObject;
      hints: Record<string, unknown>;
    };
    /**
     * Enables inspector domain notifications.
     * @request `Inspector.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables inspector domain notifications.
     * @response `Inspector.enable`
     */
    export type EnableResponse = {};
    /**
     * Disables inspector domain notifications.
     * @request `Inspector.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables inspector domain notifications.
     * @response `Inspector.disable`
     */
    export type DisableResponse = {};
    /**
     * Sent by the frontend after all initialization messages have been sent.
     * @request `Inspector.initialized`
     */
    export type InitializedRequest = {};
    /**
     * Sent by the frontend after all initialization messages have been sent.
     * @response `Inspector.initialized`
     */
    export type InitializedResponse = {};
  }
  export namespace Network {
    /**
     * Unique loader identifier.
     */
    export type LoaderId = string;
    /**
     * Unique frame identifier.
     */
    export type FrameId = string;
    /**
     * Unique request identifier.
     */
    export type RequestId = string;
    /**
     * Elapsed seconds since frontend connected.
     */
    export type Timestamp = number;
    /**
     * Number of seconds since epoch.
     */
    export type Walltime = number;
    /**
     * Controls how much referrer information is sent with the request
     */
    export type ReferrerPolicy =
      | "empty-string"
      | "no-referrer"
      | "no-referrer-when-downgrade"
      | "same-origin"
      | "origin"
      | "strict-origin"
      | "origin-when-cross-origin"
      | "strict-origin-when-cross-origin"
      | "unsafe-url";
    /**
     * Request / response headers as keys / values of JSON object.
     */
    export type Headers = Record<string, unknown>;
    /**
     * Timing information for the request.
     */
    export type ResourceTiming = {
      /**
       * Request is initiated
       */
      startTime: Timestamp;
      /**
       * Started redirect resolution.
       */
      redirectStart: Timestamp;
      /**
       * Finished redirect resolution.
       */
      redirectEnd: Timestamp;
      /**
       * Resource fetching started.
       */
      fetchStart: Timestamp;
      /**
       * Started DNS address resolve in milliseconds relative to fetchStart.
       */
      domainLookupStart: number;
      /**
       * Finished DNS address resolve in milliseconds relative to fetchStart.
       */
      domainLookupEnd: number;
      /**
       * Started connecting to the remote host in milliseconds relative to fetchStart.
       */
      connectStart: number;
      /**
       * Connected to the remote host in milliseconds relative to fetchStart.
       */
      connectEnd: number;
      /**
       * Started SSL handshake in milliseconds relative to fetchStart.
       */
      secureConnectionStart: number;
      /**
       * Started sending request in milliseconds relative to fetchStart.
       */
      requestStart: number;
      /**
       * Started receiving response headers in milliseconds relative to fetchStart.
       */
      responseStart: number;
      /**
       * Finished receiving response headers in milliseconds relative to fetchStart.
       */
      responseEnd: number;
    };
    /**
     * HTTP request data.
     */
    export type Request = {
      /**
       * Request URL.
       */
      url: string;
      /**
       * HTTP request method.
       */
      method: string;
      /**
       * HTTP request headers.
       */
      headers: Headers;
      /**
       * HTTP POST request data.
       */
      postData?: string | undefined;
      /**
       * The level of included referrer information.
       */
      referrerPolicy?: ReferrerPolicy | undefined;
      /**
       * The base64 cryptographic hash of the resource.
       */
      integrity?: string | undefined;
    };
    /**
     * HTTP response data.
     */
    export type Response = {
      /**
       * Response URL. This URL can be different from CachedResource.url in case of redirect.
       */
      url: string;
      /**
       * HTTP response status code.
       */
      status: number;
      /**
       * HTTP response status text.
       */
      statusText: string;
      /**
       * HTTP response headers.
       */
      headers: Headers;
      /**
       * Resource mimeType as determined by the browser.
       */
      mimeType: string;
      /**
       * Specifies where the response came from.
       */
      source: "unknown" | "network" | "memory-cache" | "disk-cache" | "service-worker" | "inspector-override";
      /**
       * Refined HTTP request headers that were actually transmitted over the network.
       */
      requestHeaders?: Headers | undefined;
      /**
       * Timing information for the given request.
       */
      timing?: ResourceTiming | undefined;
      /**
       * The security information for the given request.
       */
      security?: Security.Security | undefined;
    };
    /**
     * Network load metrics.
     */
    export type Metrics = {
      /**
       * Network protocol. ALPN Protocol ID Identification Sequence, as per RFC 7301 (for example, http/2, http/1.1, spdy/3.1)
       */
      protocol?: string | undefined;
      /**
       * Network priority.
       */
      priority?: "low" | "medium" | "high" | undefined;
      /**
       * Connection identifier.
       */
      connectionIdentifier?: string | undefined;
      /**
       * Remote IP address.
       */
      remoteAddress?: string | undefined;
      /**
       * Refined HTTP request headers that were actually transmitted over the network.
       */
      requestHeaders?: Headers | undefined;
      /**
       * Total HTTP request header bytes sent over the network.
       */
      requestHeaderBytesSent?: number | undefined;
      /**
       * Total HTTP request body bytes sent over the network.
       */
      requestBodyBytesSent?: number | undefined;
      /**
       * Total HTTP response header bytes received over the network.
       */
      responseHeaderBytesReceived?: number | undefined;
      /**
       * Total HTTP response body bytes received over the network.
       */
      responseBodyBytesReceived?: number | undefined;
      /**
       * Total decoded response body size in bytes.
       */
      responseBodyDecodedSize?: number | undefined;
      /**
       * Connection information for the completed request.
       */
      securityConnection?: Security.Connection | undefined;
      /**
       * Whether or not the connection was proxied through a server. If <code>true</code>, the <code>remoteAddress</code> will be for the proxy server, not the server that provided the resource to the proxy server.
       */
      isProxyConnection?: boolean | undefined;
    };
    /**
     * WebSocket request data.
     */
    export type WebSocketRequest = {
      /**
       * HTTP response headers.
       */
      headers: Headers;
    };
    /**
     * WebSocket response data.
     */
    export type WebSocketResponse = {
      /**
       * HTTP response status code.
       */
      status: number;
      /**
       * HTTP response status text.
       */
      statusText: string;
      /**
       * HTTP response headers.
       */
      headers: Headers;
    };
    /**
     * WebSocket frame data.
     */
    export type WebSocketFrame = {
      /**
       * WebSocket frame opcode.
       */
      opcode: number;
      /**
       * WebSocket frame mask.
       */
      mask: boolean;
      /**
       * WebSocket frame payload data, binary frames (opcode = 2) are base64-encoded.
       */
      payloadData: string;
      /**
       * WebSocket frame payload length in bytes.
       */
      payloadLength: number;
    };
    /**
     * Information about the cached resource.
     */
    export type CachedResource = {
      /**
       * Resource URL. This is the url of the original network request.
       */
      url: string;
      /**
       * Type of this resource.
       */
      type: Page.ResourceType;
      /**
       * Cached response data.
       */
      response?: Response | undefined;
      /**
       * Cached response body size.
       */
      bodySize: number;
      /**
       * URL of source map associated with this resource (if any).
       */
      sourceMapURL?: string | undefined;
    };
    /**
     * Information about the request initiator.
     */
    export type Initiator = {
      /**
       * Type of this initiator.
       */
      type: "parser" | "script" | "other";
      /**
       * Initiator JavaScript stack trace, set for Script only.
       */
      stackTrace?: Console.StackTrace | undefined;
      /**
       * Initiator URL, set for Parser type only.
       */
      url?: string | undefined;
      /**
       * Initiator line number, set for Parser type only.
       */
      lineNumber?: number | undefined;
      /**
       * Set if the load was triggered by a DOM node, in addition to the other initiator information.
       */
      nodeId?: DOM.NodeId | undefined;
    };
    /**
     * Different stages of a network request.
     */
    export type NetworkStage = "request" | "response";
    /**
     * Different stages of a network request.
     */
    export type ResourceErrorType = "General" | "AccessControl" | "Cancellation" | "Timeout";
    /**
     * Fired when page is about to send HTTP request.
     * @event `Network.requestWillBeSent`
     */
    export type RequestWillBeSentEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Frame identifier.
       */
      frameId: FrameId;
      /**
       * Loader identifier.
       */
      loaderId: LoaderId;
      /**
       * URL of the document this request is loaded for.
       */
      documentURL: string;
      /**
       * Request data.
       */
      request: Request;
      timestamp: Timestamp;
      walltime: Walltime;
      /**
       * Request initiator.
       */
      initiator: Initiator;
      /**
       * Redirect response data.
       */
      redirectResponse?: Response | undefined;
      /**
       * Resource type.
       */
      type?: Page.ResourceType | undefined;
      /**
       * Identifier for the context of where the load originated. In general this is the target identifier. For Workers this will be the workerId.
       */
      targetId?: string | undefined;
    };
    /**
     * Fired when HTTP response is available.
     * @event `Network.responseReceived`
     */
    export type ResponseReceivedEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Frame identifier.
       */
      frameId: FrameId;
      /**
       * Loader identifier.
       */
      loaderId: LoaderId;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
      /**
       * Resource type.
       */
      type: Page.ResourceType;
      /**
       * Response data.
       */
      response: Response;
    };
    /**
     * Fired when data chunk was received over the network.
     * @event `Network.dataReceived`
     */
    export type DataReceivedEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
      /**
       * Data chunk length.
       */
      dataLength: number;
      /**
       * Actual bytes received (might be less than dataLength for compressed encodings).
       */
      encodedDataLength: number;
    };
    /**
     * Fired when HTTP request has finished loading.
     * @event `Network.loadingFinished`
     */
    export type LoadingFinishedEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
      /**
       * URL of source map associated with this resource (if any).
       */
      sourceMapURL?: string | undefined;
      /**
       * Network metrics.
       */
      metrics?: Metrics | undefined;
    };
    /**
     * Fired when HTTP request has failed to load.
     * @event `Network.loadingFailed`
     */
    export type LoadingFailedEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
      /**
       * User friendly error message.
       */
      errorText: string;
      /**
       * True if loading was canceled.
       */
      canceled?: boolean | undefined;
    };
    /**
     * Fired when HTTP request has been served from memory cache.
     * @event `Network.requestServedFromMemoryCache`
     */
    export type RequestServedFromMemoryCacheEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Frame identifier.
       */
      frameId: FrameId;
      /**
       * Loader identifier.
       */
      loaderId: LoaderId;
      /**
       * URL of the document this request is loaded for.
       */
      documentURL: string;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
      /**
       * Request initiator.
       */
      initiator: Initiator;
      /**
       * Cached resource data.
       */
      resource: CachedResource;
    };
    /**
     * Fired when HTTP request has been intercepted. The frontend must respond with <code>Network.interceptContinue</code>, <code>Network.interceptWithRequest</code>` or <code>Network.interceptWithResponse</code>` to resolve this request.
     * @event `Network.requestIntercepted`
     */
    export type RequestInterceptedEvent = {
      /**
       * Identifier for this intercepted network. Corresponds with an earlier <code>Network.requestWillBeSent</code>.
       */
      requestId: RequestId;
      /**
       * Original request content that would proceed if this is continued.
       */
      request: Request;
    };
    /**
     * Fired when HTTP response has been intercepted. The frontend must response with <code>Network.interceptContinue</code> or <code>Network.interceptWithResponse</code>` to continue this response.
     * @event `Network.responseIntercepted`
     */
    export type ResponseInterceptedEvent = {
      /**
       * Identifier for this intercepted network. Corresponds with an earlier <code>Network.requestWillBeSent</code>.
       */
      requestId: RequestId;
      /**
       * Original response content that would proceed if this is continued.
       */
      response: Response;
    };
    /**
     * Fired when WebSocket is about to initiate handshake.
     * @event `Network.webSocketWillSendHandshakeRequest`
     */
    export type WebSocketWillSendHandshakeRequestEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      timestamp: Timestamp;
      walltime: Walltime;
      /**
       * WebSocket request data.
       */
      request: WebSocketRequest;
    };
    /**
     * Fired when WebSocket handshake response becomes available.
     * @event `Network.webSocketHandshakeResponseReceived`
     */
    export type WebSocketHandshakeResponseReceivedEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      timestamp: Timestamp;
      /**
       * WebSocket response data.
       */
      response: WebSocketResponse;
    };
    /**
     * Fired upon WebSocket creation.
     * @event `Network.webSocketCreated`
     */
    export type WebSocketCreatedEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * WebSocket request URL.
       */
      url: string;
    };
    /**
     * Fired when WebSocket is closed.
     * @event `Network.webSocketClosed`
     */
    export type WebSocketClosedEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
    };
    /**
     * Fired when WebSocket frame is received.
     * @event `Network.webSocketFrameReceived`
     */
    export type WebSocketFrameReceivedEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
      /**
       * WebSocket response data.
       */
      response: WebSocketFrame;
    };
    /**
     * Fired when WebSocket frame error occurs.
     * @event `Network.webSocketFrameError`
     */
    export type WebSocketFrameErrorEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
      /**
       * WebSocket frame error message.
       */
      errorMessage: string;
    };
    /**
     * Fired when WebSocket frame is sent.
     * @event `Network.webSocketFrameSent`
     */
    export type WebSocketFrameSentEvent = {
      /**
       * Request identifier.
       */
      requestId: RequestId;
      /**
       * Timestamp.
       */
      timestamp: Timestamp;
      /**
       * WebSocket response data.
       */
      response: WebSocketFrame;
    };
    /**
     * Enables network tracking, network events will now be delivered to the client.
     * @request `Network.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables network tracking, network events will now be delivered to the client.
     * @response `Network.enable`
     */
    export type EnableResponse = {};
    /**
     * Disables network tracking, prevents network events from being sent to the client.
     * @request `Network.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables network tracking, prevents network events from being sent to the client.
     * @response `Network.disable`
     */
    export type DisableResponse = {};
    /**
     * Specifies whether to always send extra HTTP headers with the requests from this page.
     * @request `Network.setExtraHTTPHeaders`
     */
    export type SetExtraHTTPHeadersRequest = {
      /**
       * Map with extra HTTP headers.
       */
      headers: Headers;
    };
    /**
     * Specifies whether to always send extra HTTP headers with the requests from this page.
     * @response `Network.setExtraHTTPHeaders`
     */
    export type SetExtraHTTPHeadersResponse = {};
    /**
     * Returns content served for the given request.
     * @request `Network.getResponseBody`
     */
    export type GetResponseBodyRequest = {
      /**
       * Identifier of the network request to get content for.
       */
      requestId: RequestId;
    };
    /**
     * Returns content served for the given request.
     * @response `Network.getResponseBody`
     */
    export type GetResponseBodyResponse = {
      /**
       * Response body.
       */
      body: string;
      /**
       * True, if content was sent as base64.
       */
      base64Encoded: boolean;
    };
    /**
     * Toggles whether the resource cache may be used when loading resources in the inspected page. If <code>true</code>, the resource cache will not be used when loading resources.
     * @request `Network.setResourceCachingDisabled`
     */
    export type SetResourceCachingDisabledRequest = {
      /**
       * Whether to prevent usage of the resource cache.
       */
      disabled: boolean;
    };
    /**
     * Toggles whether the resource cache may be used when loading resources in the inspected page. If <code>true</code>, the resource cache will not be used when loading resources.
     * @response `Network.setResourceCachingDisabled`
     */
    export type SetResourceCachingDisabledResponse = {};
    /**
     * Loads a resource in the context of a frame on the inspected page without cross origin checks.
     * @request `Network.loadResource`
     */
    export type LoadResourceRequest = {
      /**
       * Frame to load the resource from.
       */
      frameId: FrameId;
      /**
       * URL of the resource to load.
       */
      url: string;
    };
    /**
     * Loads a resource in the context of a frame on the inspected page without cross origin checks.
     * @response `Network.loadResource`
     */
    export type LoadResourceResponse = {
      /**
       * Resource content.
       */
      content: string;
      /**
       * Resource mimeType.
       */
      mimeType: string;
      /**
       * HTTP response status code.
       */
      status: number;
    };
    /**
     * Fetches a serialized secure certificate for the given requestId to be displayed via InspectorFrontendHost.showCertificate.
     * @request `Network.getSerializedCertificate`
     */
    export type GetSerializedCertificateRequest = {
      requestId: RequestId;
    };
    /**
     * Fetches a serialized secure certificate for the given requestId to be displayed via InspectorFrontendHost.showCertificate.
     * @response `Network.getSerializedCertificate`
     */
    export type GetSerializedCertificateResponse = {
      /**
       * Represents a base64 encoded WebCore::CertificateInfo object.
       */
      serializedCertificate: string;
    };
    /**
     * Resolves JavaScript WebSocket object for given request id.
     * @request `Network.resolveWebSocket`
     */
    export type ResolveWebSocketRequest = {
      /**
       * Identifier of the WebSocket resource to resolve.
       */
      requestId: RequestId;
      /**
       * Symbolic group name that can be used to release multiple objects.
       */
      objectGroup?: string | undefined;
    };
    /**
     * Resolves JavaScript WebSocket object for given request id.
     * @response `Network.resolveWebSocket`
     */
    export type ResolveWebSocketResponse = {
      /**
       * JavaScript object wrapper for given node.
       */
      object: Runtime.RemoteObject;
    };
    /**
     * Enable interception of network requests.
     * @request `Network.setInterceptionEnabled`
     */
    export type SetInterceptionEnabledRequest = {
      enabled: boolean;
    };
    /**
     * Enable interception of network requests.
     * @response `Network.setInterceptionEnabled`
     */
    export type SetInterceptionEnabledResponse = {};
    /**
     * Add an interception.
     * @request `Network.addInterception`
     */
    export type AddInterceptionRequest = {
      /**
       * URL pattern to intercept, intercept everything if not specified or empty
       */
      url: string;
      /**
       * Stage to intercept.
       */
      stage: NetworkStage;
      /**
       * If false, ignores letter casing of `url` parameter.
       */
      caseSensitive?: boolean | undefined;
      /**
       * If true, treats `url` parameter as a regular expression.
       */
      isRegex?: boolean | undefined;
    };
    /**
     * Add an interception.
     * @response `Network.addInterception`
     */
    export type AddInterceptionResponse = {};
    /**
     * Remove an interception.
     * @request `Network.removeInterception`
     */
    export type RemoveInterceptionRequest = {
      url: string;
      /**
       * Stage to intercept.
       */
      stage: NetworkStage;
      /**
       * If false, ignores letter casing of `url` parameter.
       */
      caseSensitive?: boolean | undefined;
      /**
       * If true, treats `url` parameter as a regular expression.
       */
      isRegex?: boolean | undefined;
    };
    /**
     * Remove an interception.
     * @response `Network.removeInterception`
     */
    export type RemoveInterceptionResponse = {};
    /**
     * Continue request or response without modifications.
     * @request `Network.interceptContinue`
     */
    export type InterceptContinueRequest = {
      /**
       * Identifier for the intercepted Network request or response to continue.
       */
      requestId: RequestId;
      /**
       * Stage to continue.
       */
      stage: NetworkStage;
    };
    /**
     * Continue request or response without modifications.
     * @response `Network.interceptContinue`
     */
    export type InterceptContinueResponse = {};
    /**
     * Replace intercepted request with the provided one.
     * @request `Network.interceptWithRequest`
     */
    export type InterceptWithRequestRequest = {
      /**
       * Identifier for the intercepted Network request or response to continue.
       */
      requestId: RequestId;
      /**
       * HTTP request url.
       */
      url?: string | undefined;
      /**
       * HTTP request method.
       */
      method?: string | undefined;
      /**
       * HTTP response headers. Pass through original values if unmodified.
       */
      headers?: Headers | undefined;
      /**
       * HTTP POST request data, base64-encoded.
       */
      postData?: string | undefined;
    };
    /**
     * Replace intercepted request with the provided one.
     * @response `Network.interceptWithRequest`
     */
    export type InterceptWithRequestResponse = {};
    /**
     * Provide response content for an intercepted response.
     * @request `Network.interceptWithResponse`
     */
    export type InterceptWithResponseRequest = {
      /**
       * Identifier for the intercepted Network response to modify.
       */
      requestId: RequestId;
      content: string;
      /**
       * True, if content was sent as base64.
       */
      base64Encoded: boolean;
      /**
       * MIME Type for the data.
       */
      mimeType?: string | undefined;
      /**
       * HTTP response status code. Pass through original values if unmodified.
       */
      status?: number | undefined;
      /**
       * HTTP response status text. Pass through original values if unmodified.
       */
      statusText?: string | undefined;
      /**
       * HTTP response headers. Pass through original values if unmodified.
       */
      headers?: Headers | undefined;
    };
    /**
     * Provide response content for an intercepted response.
     * @response `Network.interceptWithResponse`
     */
    export type InterceptWithResponseResponse = {};
    /**
     * Provide response for an intercepted request. Request completely bypasses the network in this case and is immediately fulfilled with the provided data.
     * @request `Network.interceptRequestWithResponse`
     */
    export type InterceptRequestWithResponseRequest = {
      /**
       * Identifier for the intercepted Network response to modify.
       */
      requestId: RequestId;
      content: string;
      /**
       * True, if content was sent as base64.
       */
      base64Encoded: boolean;
      /**
       * MIME Type for the data.
       */
      mimeType: string;
      /**
       * HTTP response status code.
       */
      status: number;
      /**
       * HTTP response status text.
       */
      statusText: string;
      /**
       * HTTP response headers.
       */
      headers: Headers;
    };
    /**
     * Provide response for an intercepted request. Request completely bypasses the network in this case and is immediately fulfilled with the provided data.
     * @response `Network.interceptRequestWithResponse`
     */
    export type InterceptRequestWithResponseResponse = {};
    /**
     * Fail request with given error type.
     * @request `Network.interceptRequestWithError`
     */
    export type InterceptRequestWithErrorRequest = {
      /**
       * Identifier for the intercepted Network request to fail.
       */
      requestId: RequestId;
      /**
       * Deliver error reason for the request failure.
       */
      errorType: ResourceErrorType;
    };
    /**
     * Fail request with given error type.
     * @response `Network.interceptRequestWithError`
     */
    export type InterceptRequestWithErrorResponse = {};
    /**
     * Emulate various network conditions (e.g. bytes per second, latency, etc.).
     * @request `Network.setEmulatedConditions`
     */
    export type SetEmulatedConditionsRequest = {
      /**
       * Limits the bytes per second of requests if positive. Removes any limits if zero or not provided.
       */
      bytesPerSecondLimit?: number | undefined;
    };
    /**
     * Emulate various network conditions (e.g. bytes per second, latency, etc.).
     * @response `Network.setEmulatedConditions`
     */
    export type SetEmulatedConditionsResponse = {};
  }
  export namespace Runtime {
    /**
     * Unique object identifier.
     */
    export type RemoteObjectId = string;
    /**
     * Mirror object referencing original JavaScript object.
     */
    export type RemoteObject = {
      /**
       * Object type.
       */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
      /**
       * Object subtype hint. Specified for <code>object</code> <code>function</code> (for class) type values only.
       */
      subtype?:
        | "array"
        | "null"
        | "node"
        | "regexp"
        | "date"
        | "error"
        | "map"
        | "set"
        | "weakmap"
        | "weakset"
        | "iterator"
        | "class"
        | "proxy"
        | "weakref"
        | undefined;
      /**
       * Object class (constructor) name. Specified for <code>object</code> type values only.
       */
      className?: string | undefined;
      /**
       * Remote object value (in case of primitive values or JSON values if it was requested).
       */
      value?: unknown | undefined;
      /**
       * String representation of the object.
       */
      description?: string | undefined;
      /**
       * Unique object identifier (for non-primitive values).
       */
      objectId?: RemoteObjectId | undefined;
      /**
       * Size of the array/collection. Specified for array/map/set/weakmap/weakset object type values only.
       */
      size?: number | undefined;
      /**
       * Remote object for the class prototype. Specified for class object type values only.
       */
      classPrototype?: RemoteObject | undefined;
      /**
       * Preview containing abbreviated property values. Specified for <code>object</code> type values only.
       */
      preview?: ObjectPreview | undefined;
    };
    /**
     * Object containing abbreviated remote object value.
     */
    export type ObjectPreview = {
      /**
       * Object type.
       */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
      /**
       * Object subtype hint. Specified for <code>object</code> type values only.
       */
      subtype?:
        | "array"
        | "null"
        | "node"
        | "regexp"
        | "date"
        | "error"
        | "map"
        | "set"
        | "weakmap"
        | "weakset"
        | "iterator"
        | "class"
        | "proxy"
        | "weakref"
        | undefined;
      /**
       * String representation of the object.
       */
      description?: string | undefined;
      /**
       * Determines whether preview is lossless (contains all information of the original object).
       */
      lossless: boolean;
      /**
       * True iff some of the properties of the original did not fit.
       */
      overflow?: boolean | undefined;
      /**
       * List of the properties.
       */
      properties?: PropertyPreview[] | undefined;
      /**
       * List of the entries. Specified for <code>map</code> and <code>set</code> subtype values only.
       */
      entries?: EntryPreview[] | undefined;
      /**
       * Size of the array/collection. Specified for array/map/set/weakmap/weakset object type values only.
       */
      size?: number | undefined;
    };
    export type PropertyPreview = {
      /**
       * Property name.
       */
      name: string;
      /**
       * Object type.
       */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint" | "accessor";
      /**
       * Object subtype hint. Specified for <code>object</code> type values only.
       */
      subtype?:
        | "array"
        | "null"
        | "node"
        | "regexp"
        | "date"
        | "error"
        | "map"
        | "set"
        | "weakmap"
        | "weakset"
        | "iterator"
        | "class"
        | "proxy"
        | "weakref"
        | undefined;
      /**
       * User-friendly property value string.
       */
      value?: string | undefined;
      /**
       * Nested value preview.
       */
      valuePreview?: ObjectPreview | undefined;
      /**
       * True if this is a private field.
       */
      isPrivate?: boolean | undefined;
      /**
       * True if this is an internal property.
       */
      internal?: boolean | undefined;
    };
    export type EntryPreview = {
      /**
       * Entry key. Specified for map-like collection entries.
       */
      key?: ObjectPreview | undefined;
      /**
       * Entry value.
       */
      value: ObjectPreview;
    };
    export type CollectionEntry = {
      /**
       * Entry key of a map-like collection, otherwise not provided.
       */
      key?: Runtime.RemoteObject | undefined;
      /**
       * Entry value.
       */
      value: Runtime.RemoteObject;
    };
    /**
     * Object property descriptor.
     */
    export type PropertyDescriptor = {
      /**
       * Property name or symbol description.
       */
      name: string;
      /**
       * The value associated with the property.
       */
      value?: RemoteObject | undefined;
      /**
       * True if the value associated with the property may be changed (data descriptors only).
       */
      writable?: boolean | undefined;
      /**
       * A function which serves as a getter for the property, or <code>undefined</code> if there is no getter (accessor descriptors only).
       */
      get?: RemoteObject | undefined;
      /**
       * A function which serves as a setter for the property, or <code>undefined</code> if there is no setter (accessor descriptors only).
       */
      set?: RemoteObject | undefined;
      /**
       * True if the result was thrown during the evaluation.
       */
      wasThrown?: boolean | undefined;
      /**
       * True if the type of this property descriptor may be changed and if the property may be deleted from the corresponding object.
       */
      configurable?: boolean | undefined;
      /**
       * True if this property shows up during enumeration of the properties on the corresponding object.
       */
      enumerable?: boolean | undefined;
      /**
       * True if the property is owned for the object.
       */
      isOwn?: boolean | undefined;
      /**
       * Property symbol object, if the property is a symbol.
       */
      symbol?: Runtime.RemoteObject | undefined;
      /**
       * True if the property is a private field.
       */
      isPrivate?: boolean | undefined;
      /**
       * True if the property value came from a native getter.
       */
      nativeGetter?: boolean | undefined;
    };
    /**
     * Object internal property descriptor. This property isn't normally visible in JavaScript code.
     */
    export type InternalPropertyDescriptor = {
      /**
       * Conventional property name.
       */
      name: string;
      /**
       * The value associated with the property.
       */
      value?: RemoteObject | undefined;
    };
    /**
     * Represents function call argument. Either remote object id <code>objectId</code> or primitive <code>value</code> or neither of (for undefined) them should be specified.
     */
    export type CallArgument = {
      /**
       * Primitive value.
       */
      value?: unknown | undefined;
      /**
       * Remote object handle.
       */
      objectId?: RemoteObjectId | undefined;
    };
    /**
     * Id of an execution context.
     */
    export type ExecutionContextId = number;
    /**
     * Type of the execution context.
     */
    export type ExecutionContextType = "normal" | "user" | "internal";
    /**
     * Description of an isolated world.
     */
    export type ExecutionContextDescription = {
      /**
       * Unique id of the execution context. It can be used to specify in which execution context script evaluation should be performed.
       */
      id: ExecutionContextId;
      type: ExecutionContextType;
      /**
       * Human readable name describing given context.
       */
      name: string;
      /**
       * Id of the owning frame.
       */
      frameId: Network.FrameId;
    };
    /**
     * Syntax error type: "none" for no error, "irrecoverable" for unrecoverable errors, "unterminated-literal" for when there is an unterminated literal, "recoverable" for when the expression is unfinished but valid so far.
     */
    export type SyntaxErrorType = "none" | "irrecoverable" | "unterminated-literal" | "recoverable";
    /**
     * Range of an error in source code.
     */
    export type ErrorRange = {
      /**
       * Start offset of range (inclusive).
       */
      startOffset: number;
      /**
       * End offset of range (exclusive).
       */
      endOffset: number;
    };
    export type StructureDescription = {
      /**
       * Array of strings, where the strings represent object properties.
       */
      fields?: string[] | undefined;
      /**
       * Array of strings, where the strings represent optional object properties.
       */
      optionalFields?: string[] | undefined;
      /**
       * Name of the constructor.
       */
      constructorName?: string | undefined;
      /**
       * Pointer to the StructureRepresentation of the protoype if one exists.
       */
      prototypeStructure?: StructureDescription | undefined;
      /**
       * If true, it indicates that the fields in this StructureDescription may be inaccurate. I.e, there might have been fields that have been deleted before it was profiled or it has fields we haven't profiled.
       */
      isImprecise?: boolean | undefined;
    };
    export type TypeSet = {
      /**
       * Indicates if this type description has been type Function.
       */
      isFunction: boolean;
      /**
       * Indicates if this type description has been type Undefined.
       */
      isUndefined: boolean;
      /**
       * Indicates if this type description has been type Null.
       */
      isNull: boolean;
      /**
       * Indicates if this type description has been type Boolean.
       */
      isBoolean: boolean;
      /**
       * Indicates if this type description has been type Integer.
       */
      isInteger: boolean;
      /**
       * Indicates if this type description has been type Number.
       */
      isNumber: boolean;
      /**
       * Indicates if this type description has been type String.
       */
      isString: boolean;
      /**
       * Indicates if this type description has been type Object.
       */
      isObject: boolean;
      /**
       * Indicates if this type description has been type Symbol.
       */
      isSymbol: boolean;
      /**
       * Indicates if this type description has been type BigInt.
       */
      isBigInt: boolean;
    };
    /**
     * Container for type information that has been gathered.
     */
    export type TypeDescription = {
      /**
       * If true, we were able to correlate the offset successfuly with a program location. If false, the offset may be bogus or the offset may be from a CodeBlock that hasn't executed.
       */
      isValid: boolean;
      /**
       * Least common ancestor of all Constructors if the TypeDescription has seen any structures. This string is the display name of the shared constructor function.
       */
      leastCommonAncestor?: string | undefined;
      /**
       * Set of booleans for determining the aggregate type of this type description.
       */
      typeSet?: TypeSet | undefined;
      /**
       * Array of descriptions for all structures seen for this variable.
       */
      structures?: StructureDescription[] | undefined;
      /**
       * If true, this indicates that no more structures are being profiled because some maximum threshold has been reached and profiling has stopped because of memory pressure.
       */
      isTruncated?: boolean | undefined;
    };
    /**
     * Describes the location of an expression we want type information for.
     */
    export type TypeLocation = {
      /**
       * What kind of type information do we want (normal, function return values, 'this' statement).
       */
      typeInformationDescriptor: number;
      /**
       * sourceID uniquely identifying a script
       */
      sourceID: string;
      /**
       * character offset for assignment range
       */
      divot: number;
    };
    /**
     * From Wikipedia: a basic block is a portion of the code within a program with only one entry point and only one exit point. This type gives the location of a basic block and if that basic block has executed.
     */
    export type BasicBlock = {
      /**
       * Start offset of the basic block.
       */
      startOffset: number;
      /**
       * End offset of the basic block.
       */
      endOffset: number;
      /**
       * Indicates if the basic block has executed before.
       */
      hasExecuted: boolean;
      /**
       * Indicates how many times the basic block has executed.
       */
      executionCount: number;
    };
    /**
     * Issued when new execution context is created.
     * @event `Runtime.executionContextCreated`
     */
    export type ExecutionContextCreatedEvent = {
      /**
       * A newly created execution context.
       */
      context: ExecutionContextDescription;
    };
    /**
     * Parses JavaScript source code for errors.
     * @request `Runtime.parse`
     */
    export type ParseRequest = {
      /**
       * Source code to parse.
       */
      source: string;
    };
    /**
     * Parses JavaScript source code for errors.
     * @response `Runtime.parse`
     */
    export type ParseResponse = {
      /**
       * Parse result.
       */
      result: SyntaxErrorType;
      /**
       * Parse error message.
       */
      message?: string | undefined;
      /**
       * Range in the source where the error occurred.
       */
      range?: ErrorRange | undefined;
    };
    /**
     * Evaluates expression on global object.
     * @request `Runtime.evaluate`
     */
    export type EvaluateRequest = {
      /**
       * Expression to evaluate.
       */
      expression: string;
      /**
       * Symbolic group name that can be used to release multiple objects.
       */
      objectGroup?: string | undefined;
      /**
       * Determines whether Command Line API should be available during the evaluation.
       */
      includeCommandLineAPI?: boolean | undefined;
      /**
       * Specifies whether evaluation should stop on exceptions and mute console. Overrides setPauseOnException state.
       */
      doNotPauseOnExceptionsAndMuteConsole?: boolean | undefined;
      /**
       * Specifies in which isolated context to perform evaluation. Each content script lives in an isolated context and this parameter may be used to specify one of those contexts. If the parameter is omitted or 0 the evaluation will be performed in the context of the inspected page.
       */
      contextId?: Runtime.ExecutionContextId | undefined;
      /**
       * Whether the result is expected to be a JSON object that should be sent by value.
       */
      returnByValue?: boolean | undefined;
      /**
       * Whether preview should be generated for the result.
       */
      generatePreview?: boolean | undefined;
      /**
       * Whether the resulting value should be considered for saving in the $n history.
       */
      saveResult?: boolean | undefined;
      /**
       * Whether the expression should be considered to be in a user gesture or not.
       */
      emulateUserGesture?: boolean | undefined;
    };
    /**
     * Evaluates expression on global object.
     * @response `Runtime.evaluate`
     */
    export type EvaluateResponse = {
      /**
       * Evaluation result.
       */
      result: RemoteObject;
      /**
       * True if the result was thrown during the evaluation.
       */
      wasThrown?: boolean | undefined;
      /**
       * If the result was saved, this is the $n index that can be used to access the value.
       */
      savedResultIndex?: number | undefined;
    };
    /**
     * Calls the async callback when the promise with the given ID gets settled.
     * @request `Runtime.awaitPromise`
     */
    export type AwaitPromiseRequest = {
      /**
       * Identifier of the promise.
       */
      promiseObjectId: RemoteObjectId;
      /**
       * Whether the result is expected to be a JSON object that should be sent by value.
       */
      returnByValue?: boolean | undefined;
      /**
       * Whether preview should be generated for the result.
       */
      generatePreview?: boolean | undefined;
      /**
       * Whether the resulting value should be considered for saving in the $n history.
       */
      saveResult?: boolean | undefined;
    };
    /**
     * Calls the async callback when the promise with the given ID gets settled.
     * @response `Runtime.awaitPromise`
     */
    export type AwaitPromiseResponse = {
      /**
       * Evaluation result.
       */
      result: RemoteObject;
      /**
       * True if the result was thrown during the evaluation.
       */
      wasThrown?: boolean | undefined;
      /**
       * If the result was saved, this is the $n index that can be used to access the value.
       */
      savedResultIndex?: number | undefined;
    };
    /**
     * Calls function with given declaration on the given object. Object group of the result is inherited from the target object.
     * @request `Runtime.callFunctionOn`
     */
    export type CallFunctionOnRequest = {
      /**
       * Identifier of the object to call function on.
       */
      objectId: RemoteObjectId;
      /**
       * Declaration of the function to call.
       */
      functionDeclaration: string;
      /**
       * Call arguments. All call arguments must belong to the same JavaScript world as the target object.
       */
      arguments?: CallArgument[] | undefined;
      /**
       * Specifies whether function call should stop on exceptions and mute console. Overrides setPauseOnException state.
       */
      doNotPauseOnExceptionsAndMuteConsole?: boolean | undefined;
      /**
       * Whether the result is expected to be a JSON object which should be sent by value.
       */
      returnByValue?: boolean | undefined;
      /**
       * Whether preview should be generated for the result.
       */
      generatePreview?: boolean | undefined;
      /**
       * Whether the expression should be considered to be in a user gesture or not.
       */
      emulateUserGesture?: boolean | undefined;
    };
    /**
     * Calls function with given declaration on the given object. Object group of the result is inherited from the target object.
     * @response `Runtime.callFunctionOn`
     */
    export type CallFunctionOnResponse = {
      /**
       * Call result.
       */
      result: RemoteObject;
      /**
       * True if the result was thrown during the evaluation.
       */
      wasThrown?: boolean | undefined;
    };
    /**
     * Returns a preview for the given object.
     * @request `Runtime.getPreview`
     */
    export type GetPreviewRequest = {
      /**
       * Identifier of the object to return a preview for.
       */
      objectId: RemoteObjectId;
    };
    /**
     * Returns a preview for the given object.
     * @response `Runtime.getPreview`
     */
    export type GetPreviewResponse = {
      preview: ObjectPreview;
    };
    /**
     * Returns properties of a given object. Object group of the result is inherited from the target object.
     * @request `Runtime.getProperties`
     */
    export type GetPropertiesRequest = {
      /**
       * Identifier of the object to return properties for.
       */
      objectId: RemoteObjectId;
      /**
       * If true, returns properties belonging only to the object itself, not to its prototype chain.
       */
      ownProperties?: boolean | undefined;
      /**
       * If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId` is for a `iterator`/`WeakMap`/`WeakSet` object.
       */
      fetchStart?: number | undefined;
      /**
       * If provided only return `fetchCount` values. Otherwise, return values all the way to the end.
       */
      fetchCount?: number | undefined;
      /**
       * Whether preview should be generated for property values.
       */
      generatePreview?: boolean | undefined;
    };
    /**
     * Returns properties of a given object. Object group of the result is inherited from the target object.
     * @response `Runtime.getProperties`
     */
    export type GetPropertiesResponse = {
      /**
       * Object properties.
       */
      properties: PropertyDescriptor[];
      /**
       * Internal object properties. Only included if `fetchStart` is 0.
       */
      internalProperties?: InternalPropertyDescriptor[] | undefined;
    };
    /**
     * Returns displayable properties of a given object. Object group of the result is inherited from the target object. Displayable properties are own properties, internal properties, and native getters in the prototype chain (assumed to be bindings and treated like own properties for the frontend).
     * @request `Runtime.getDisplayableProperties`
     */
    export type GetDisplayablePropertiesRequest = {
      /**
       * Identifier of the object to return properties for.
       */
      objectId: RemoteObjectId;
      /**
       * If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId` is for a `iterator`/`WeakMap`/`WeakSet` object.
       */
      fetchStart?: number | undefined;
      /**
       * If provided only return `fetchCount` values. Otherwise, return values all the way to the end.
       */
      fetchCount?: number | undefined;
      /**
       * Whether preview should be generated for property values.
       */
      generatePreview?: boolean | undefined;
    };
    /**
     * Returns displayable properties of a given object. Object group of the result is inherited from the target object. Displayable properties are own properties, internal properties, and native getters in the prototype chain (assumed to be bindings and treated like own properties for the frontend).
     * @response `Runtime.getDisplayableProperties`
     */
    export type GetDisplayablePropertiesResponse = {
      /**
       * Object properties.
       */
      properties: PropertyDescriptor[];
      /**
       * Internal object properties. Only included if `fetchStart` is 0.
       */
      internalProperties?: InternalPropertyDescriptor[] | undefined;
    };
    /**
     * Returns entries of given Map / Set collection.
     * @request `Runtime.getCollectionEntries`
     */
    export type GetCollectionEntriesRequest = {
      /**
       * Id of the collection to get entries for.
       */
      objectId: Runtime.RemoteObjectId;
      /**
       * Symbolic group name that can be used to release multiple. If not provided, it will be the same objectGroup as the RemoteObject determined from <code>objectId</code>. This is useful for WeakMap to release the collection entries.
       */
      objectGroup?: string | undefined;
      /**
       * If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId<` is for a `iterator<`/`WeakMap<`/`WeakSet<` object.
       */
      fetchStart?: number | undefined;
      /**
       * If provided only return `fetchCount` values. Otherwise, return values all the way to the end.
       */
      fetchCount?: number | undefined;
    };
    /**
     * Returns entries of given Map / Set collection.
     * @response `Runtime.getCollectionEntries`
     */
    export type GetCollectionEntriesResponse = {
      /**
       * Array of collection entries.
       */
      entries: CollectionEntry[];
    };
    /**
     * Assign a saved result index to this value.
     * @request `Runtime.saveResult`
     */
    export type SaveResultRequest = {
      /**
       * Id or value of the object to save.
       */
      value: CallArgument;
      /**
       * Unique id of the execution context. To specify in which execution context script evaluation should be performed. If not provided, determine from the CallArgument's objectId.
       */
      contextId?: ExecutionContextId | undefined;
    };
    /**
     * Assign a saved result index to this value.
     * @response `Runtime.saveResult`
     */
    export type SaveResultResponse = {
      /**
       * If the value was saved, this is the $n index that can be used to access the value.
       */
      savedResultIndex?: number | undefined;
    };
    /**
     * Creates an additional reference to all saved values in the Console using the the given string as a prefix instead of $.
     * @request `Runtime.setSavedResultAlias`
     */
    export type SetSavedResultAliasRequest = {
      /**
       * Passing an empty/null string will clear the alias.
       */
      alias?: string | undefined;
    };
    /**
     * Creates an additional reference to all saved values in the Console using the the given string as a prefix instead of $.
     * @response `Runtime.setSavedResultAlias`
     */
    export type SetSavedResultAliasResponse = {};
    /**
     * Releases remote object with given id.
     * @request `Runtime.releaseObject`
     */
    export type ReleaseObjectRequest = {
      /**
       * Identifier of the object to release.
       */
      objectId: RemoteObjectId;
    };
    /**
     * Releases remote object with given id.
     * @response `Runtime.releaseObject`
     */
    export type ReleaseObjectResponse = {};
    /**
     * Releases all remote objects that belong to a given group.
     * @request `Runtime.releaseObjectGroup`
     */
    export type ReleaseObjectGroupRequest = {
      /**
       * Symbolic object group name.
       */
      objectGroup: string;
    };
    /**
     * Releases all remote objects that belong to a given group.
     * @response `Runtime.releaseObjectGroup`
     */
    export type ReleaseObjectGroupResponse = {};
    /**
     * Enables reporting of execution contexts creation by means of <code>executionContextCreated</code> event. When the reporting gets enabled the event will be sent immediately for each existing execution context.
     * @request `Runtime.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables reporting of execution contexts creation by means of <code>executionContextCreated</code> event. When the reporting gets enabled the event will be sent immediately for each existing execution context.
     * @response `Runtime.enable`
     */
    export type EnableResponse = {};
    /**
     * Disables reporting of execution contexts creation.
     * @request `Runtime.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables reporting of execution contexts creation.
     * @response `Runtime.disable`
     */
    export type DisableResponse = {};
    /**
     * Returns detailed information on the given function.
     * @request `Runtime.getRuntimeTypesForVariablesAtOffsets`
     */
    export type GetRuntimeTypesForVariablesAtOffsetsRequest = {
      /**
       * An array of type locations we're requesting information for. Results are expected in the same order they're sent in.
       */
      locations: TypeLocation[];
    };
    /**
     * Returns detailed information on the given function.
     * @response `Runtime.getRuntimeTypesForVariablesAtOffsets`
     */
    export type GetRuntimeTypesForVariablesAtOffsetsResponse = {
      types: TypeDescription[];
    };
    /**
     * Enables type profiling on the VM.
     * @request `Runtime.enableTypeProfiler`
     */
    export type EnableTypeProfilerRequest = {};
    /**
     * Enables type profiling on the VM.
     * @response `Runtime.enableTypeProfiler`
     */
    export type EnableTypeProfilerResponse = {};
    /**
     * Disables type profiling on the VM.
     * @request `Runtime.disableTypeProfiler`
     */
    export type DisableTypeProfilerRequest = {};
    /**
     * Disables type profiling on the VM.
     * @response `Runtime.disableTypeProfiler`
     */
    export type DisableTypeProfilerResponse = {};
    /**
     * Enables control flow profiling on the VM.
     * @request `Runtime.enableControlFlowProfiler`
     */
    export type EnableControlFlowProfilerRequest = {};
    /**
     * Enables control flow profiling on the VM.
     * @response `Runtime.enableControlFlowProfiler`
     */
    export type EnableControlFlowProfilerResponse = {};
    /**
     * Disables control flow profiling on the VM.
     * @request `Runtime.disableControlFlowProfiler`
     */
    export type DisableControlFlowProfilerRequest = {};
    /**
     * Disables control flow profiling on the VM.
     * @response `Runtime.disableControlFlowProfiler`
     */
    export type DisableControlFlowProfilerResponse = {};
    /**
     * Returns a list of basic blocks for the given sourceID with information about their text ranges and whether or not they have executed.
     * @request `Runtime.getBasicBlocks`
     */
    export type GetBasicBlocksRequest = {
      /**
       * Indicates which sourceID information is requested for.
       */
      sourceID: string;
    };
    /**
     * Returns a list of basic blocks for the given sourceID with information about their text ranges and whether or not they have executed.
     * @response `Runtime.getBasicBlocks`
     */
    export type GetBasicBlocksResponse = {
      basicBlocks: BasicBlock[];
    };
  }
  export namespace ScriptProfiler {
    export type EventType = "API" | "Microtask" | "Other";
    export type Event = {
      startTime: number;
      endTime: number;
      type: EventType;
    };
    export type ExpressionLocation = {
      /**
       * 1-based.
       */
      line: number;
      /**
       * 1-based.
       */
      column: number;
    };
    export type StackFrame = {
      /**
       * Unique script identifier.
       */
      sourceID: Debugger.ScriptId;
      /**
       * A displayable name for the stack frame. i.e function name, (program), etc.
       */
      name: string;
      /**
       * -1 if unavailable. 1-based if available.
       */
      line: number;
      /**
       * -1 if unavailable. 1-based if available.
       */
      column: number;
      url: string;
      expressionLocation?: ExpressionLocation | undefined;
    };
    export type StackTrace = {
      timestamp: number;
      /**
       * First array item is the bottom of the call stack and last array item is the top of the call stack.
       */
      stackFrames: StackFrame[];
    };
    export type Samples = {
      stackTraces: StackTrace[];
    };
    /**
     * Tracking started.
     * @event `ScriptProfiler.trackingStart`
     */
    export type TrackingStartEvent = {
      timestamp: number;
    };
    /**
     * Periodic tracking updates with event data.
     * @event `ScriptProfiler.trackingUpdate`
     */
    export type TrackingUpdateEvent = {
      event: Event;
    };
    /**
     * Tracking stopped. Includes any buffered data during tracking, such as profiling information.
     * @event `ScriptProfiler.trackingComplete`
     */
    export type TrackingCompleteEvent = {
      timestamp: number;
      /**
       * Stack traces.
       */
      samples?: Samples | undefined;
    };
    /**
     * Start tracking script evaluations.
     * @request `ScriptProfiler.startTracking`
     */
    export type StartTrackingRequest = {
      /**
       * Start the sampling profiler, defaults to false.
       */
      includeSamples?: boolean | undefined;
    };
    /**
     * Start tracking script evaluations.
     * @response `ScriptProfiler.startTracking`
     */
    export type StartTrackingResponse = {};
    /**
     * Stop tracking script evaluations. This will produce a `trackingComplete` event.
     * @request `ScriptProfiler.stopTracking`
     */
    export type StopTrackingRequest = {};
    /**
     * Stop tracking script evaluations. This will produce a `trackingComplete` event.
     * @response `ScriptProfiler.stopTracking`
     */
    export type StopTrackingResponse = {};
  }
  export type EventMap = {
    "Console.messageAdded": Console.MessageAddedEvent;
    "Console.messageRepeatCountUpdated": Console.MessageRepeatCountUpdatedEvent;
    "Console.messagesCleared": Console.MessagesClearedEvent;
    "Console.heapSnapshot": Console.HeapSnapshotEvent;
    "CPUProfiler.trackingStart": CPUProfiler.TrackingStartEvent;
    "CPUProfiler.trackingUpdate": CPUProfiler.TrackingUpdateEvent;
    "CPUProfiler.trackingComplete": CPUProfiler.TrackingCompleteEvent;
    "Debugger.globalObjectCleared": Debugger.GlobalObjectClearedEvent;
    "Debugger.scriptParsed": Debugger.ScriptParsedEvent;
    "Debugger.scriptFailedToParse": Debugger.ScriptFailedToParseEvent;
    "Debugger.breakpointResolved": Debugger.BreakpointResolvedEvent;
    "Debugger.paused": Debugger.PausedEvent;
    "Debugger.resumed": Debugger.ResumedEvent;
    "Debugger.didSampleProbe": Debugger.DidSampleProbeEvent;
    "Debugger.playBreakpointActionSound": Debugger.PlayBreakpointActionSoundEvent;
    "Heap.garbageCollected": Heap.GarbageCollectedEvent;
    "Heap.trackingStart": Heap.TrackingStartEvent;
    "Heap.trackingComplete": Heap.TrackingCompleteEvent;
    "Inspector.evaluateForTestInFrontend": Inspector.EvaluateForTestInFrontendEvent;
    "Inspector.inspect": Inspector.InspectEvent;
    "Network.requestWillBeSent": Network.RequestWillBeSentEvent;
    "Network.responseReceived": Network.ResponseReceivedEvent;
    "Network.dataReceived": Network.DataReceivedEvent;
    "Network.loadingFinished": Network.LoadingFinishedEvent;
    "Network.loadingFailed": Network.LoadingFailedEvent;
    "Network.requestServedFromMemoryCache": Network.RequestServedFromMemoryCacheEvent;
    "Network.requestIntercepted": Network.RequestInterceptedEvent;
    "Network.responseIntercepted": Network.ResponseInterceptedEvent;
    "Network.webSocketWillSendHandshakeRequest": Network.WebSocketWillSendHandshakeRequestEvent;
    "Network.webSocketHandshakeResponseReceived": Network.WebSocketHandshakeResponseReceivedEvent;
    "Network.webSocketCreated": Network.WebSocketCreatedEvent;
    "Network.webSocketClosed": Network.WebSocketClosedEvent;
    "Network.webSocketFrameReceived": Network.WebSocketFrameReceivedEvent;
    "Network.webSocketFrameError": Network.WebSocketFrameErrorEvent;
    "Network.webSocketFrameSent": Network.WebSocketFrameSentEvent;
    "Runtime.executionContextCreated": Runtime.ExecutionContextCreatedEvent;
    "ScriptProfiler.trackingStart": ScriptProfiler.TrackingStartEvent;
    "ScriptProfiler.trackingUpdate": ScriptProfiler.TrackingUpdateEvent;
    "ScriptProfiler.trackingComplete": ScriptProfiler.TrackingCompleteEvent;
  };
  export type RequestMap = {
    "Console.enable": Console.EnableRequest;
    "Console.disable": Console.DisableRequest;
    "Console.clearMessages": Console.ClearMessagesRequest;
    "Console.getLoggingChannels": Console.GetLoggingChannelsRequest;
    "Console.setLoggingChannelLevel": Console.SetLoggingChannelLevelRequest;
    "CPUProfiler.startTracking": CPUProfiler.StartTrackingRequest;
    "CPUProfiler.stopTracking": CPUProfiler.StopTrackingRequest;
    "Debugger.enable": Debugger.EnableRequest;
    "Debugger.disable": Debugger.DisableRequest;
    "Debugger.setAsyncStackTraceDepth": Debugger.SetAsyncStackTraceDepthRequest;
    "Debugger.setBreakpointsActive": Debugger.SetBreakpointsActiveRequest;
    "Debugger.setBreakpointByUrl": Debugger.SetBreakpointByUrlRequest;
    "Debugger.setBreakpoint": Debugger.SetBreakpointRequest;
    "Debugger.removeBreakpoint": Debugger.RemoveBreakpointRequest;
    "Debugger.addSymbolicBreakpoint": Debugger.AddSymbolicBreakpointRequest;
    "Debugger.removeSymbolicBreakpoint": Debugger.RemoveSymbolicBreakpointRequest;
    "Debugger.continueUntilNextRunLoop": Debugger.ContinueUntilNextRunLoopRequest;
    "Debugger.continueToLocation": Debugger.ContinueToLocationRequest;
    "Debugger.stepNext": Debugger.StepNextRequest;
    "Debugger.stepOver": Debugger.StepOverRequest;
    "Debugger.stepInto": Debugger.StepIntoRequest;
    "Debugger.stepOut": Debugger.StepOutRequest;
    "Debugger.pause": Debugger.PauseRequest;
    "Debugger.resume": Debugger.ResumeRequest;
    "Debugger.searchInContent": Debugger.SearchInContentRequest;
    "Debugger.getScriptSource": Debugger.GetScriptSourceRequest;
    "Debugger.getFunctionDetails": Debugger.GetFunctionDetailsRequest;
    "Debugger.getBreakpointLocations": Debugger.GetBreakpointLocationsRequest;
    "Debugger.setPauseOnDebuggerStatements": Debugger.SetPauseOnDebuggerStatementsRequest;
    "Debugger.setPauseOnExceptions": Debugger.SetPauseOnExceptionsRequest;
    "Debugger.setPauseOnAssertions": Debugger.SetPauseOnAssertionsRequest;
    "Debugger.setPauseOnMicrotasks": Debugger.SetPauseOnMicrotasksRequest;
    "Debugger.setPauseForInternalScripts": Debugger.SetPauseForInternalScriptsRequest;
    "Debugger.evaluateOnCallFrame": Debugger.EvaluateOnCallFrameRequest;
    "Debugger.setShouldBlackboxURL": Debugger.SetShouldBlackboxURLRequest;
    "Debugger.setBlackboxBreakpointEvaluations": Debugger.SetBlackboxBreakpointEvaluationsRequest;
    "Heap.enable": Heap.EnableRequest;
    "Heap.disable": Heap.DisableRequest;
    "Heap.gc": Heap.GcRequest;
    "Heap.snapshot": Heap.SnapshotRequest;
    "Heap.startTracking": Heap.StartTrackingRequest;
    "Heap.stopTracking": Heap.StopTrackingRequest;
    "Heap.getPreview": Heap.GetPreviewRequest;
    "Heap.getRemoteObject": Heap.GetRemoteObjectRequest;
    "Inspector.enable": Inspector.EnableRequest;
    "Inspector.disable": Inspector.DisableRequest;
    "Inspector.initialized": Inspector.InitializedRequest;
    "Network.enable": Network.EnableRequest;
    "Network.disable": Network.DisableRequest;
    "Network.setExtraHTTPHeaders": Network.SetExtraHTTPHeadersRequest;
    "Network.getResponseBody": Network.GetResponseBodyRequest;
    "Network.setResourceCachingDisabled": Network.SetResourceCachingDisabledRequest;
    "Network.loadResource": Network.LoadResourceRequest;
    "Network.getSerializedCertificate": Network.GetSerializedCertificateRequest;
    "Network.resolveWebSocket": Network.ResolveWebSocketRequest;
    "Network.setInterceptionEnabled": Network.SetInterceptionEnabledRequest;
    "Network.addInterception": Network.AddInterceptionRequest;
    "Network.removeInterception": Network.RemoveInterceptionRequest;
    "Network.interceptContinue": Network.InterceptContinueRequest;
    "Network.interceptWithRequest": Network.InterceptWithRequestRequest;
    "Network.interceptWithResponse": Network.InterceptWithResponseRequest;
    "Network.interceptRequestWithResponse": Network.InterceptRequestWithResponseRequest;
    "Network.interceptRequestWithError": Network.InterceptRequestWithErrorRequest;
    "Network.setEmulatedConditions": Network.SetEmulatedConditionsRequest;
    "Runtime.parse": Runtime.ParseRequest;
    "Runtime.evaluate": Runtime.EvaluateRequest;
    "Runtime.awaitPromise": Runtime.AwaitPromiseRequest;
    "Runtime.callFunctionOn": Runtime.CallFunctionOnRequest;
    "Runtime.getPreview": Runtime.GetPreviewRequest;
    "Runtime.getProperties": Runtime.GetPropertiesRequest;
    "Runtime.getDisplayableProperties": Runtime.GetDisplayablePropertiesRequest;
    "Runtime.getCollectionEntries": Runtime.GetCollectionEntriesRequest;
    "Runtime.saveResult": Runtime.SaveResultRequest;
    "Runtime.setSavedResultAlias": Runtime.SetSavedResultAliasRequest;
    "Runtime.releaseObject": Runtime.ReleaseObjectRequest;
    "Runtime.releaseObjectGroup": Runtime.ReleaseObjectGroupRequest;
    "Runtime.enable": Runtime.EnableRequest;
    "Runtime.disable": Runtime.DisableRequest;
    "Runtime.getRuntimeTypesForVariablesAtOffsets": Runtime.GetRuntimeTypesForVariablesAtOffsetsRequest;
    "Runtime.enableTypeProfiler": Runtime.EnableTypeProfilerRequest;
    "Runtime.disableTypeProfiler": Runtime.DisableTypeProfilerRequest;
    "Runtime.enableControlFlowProfiler": Runtime.EnableControlFlowProfilerRequest;
    "Runtime.disableControlFlowProfiler": Runtime.DisableControlFlowProfilerRequest;
    "Runtime.getBasicBlocks": Runtime.GetBasicBlocksRequest;
    "ScriptProfiler.startTracking": ScriptProfiler.StartTrackingRequest;
    "ScriptProfiler.stopTracking": ScriptProfiler.StopTrackingRequest;
  };
  export type ResponseMap = {
    "Console.enable": Console.EnableResponse;
    "Console.disable": Console.DisableResponse;
    "Console.clearMessages": Console.ClearMessagesResponse;
    "Console.getLoggingChannels": Console.GetLoggingChannelsResponse;
    "Console.setLoggingChannelLevel": Console.SetLoggingChannelLevelResponse;
    "CPUProfiler.startTracking": CPUProfiler.StartTrackingResponse;
    "CPUProfiler.stopTracking": CPUProfiler.StopTrackingResponse;
    "Debugger.enable": Debugger.EnableResponse;
    "Debugger.disable": Debugger.DisableResponse;
    "Debugger.setAsyncStackTraceDepth": Debugger.SetAsyncStackTraceDepthResponse;
    "Debugger.setBreakpointsActive": Debugger.SetBreakpointsActiveResponse;
    "Debugger.setBreakpointByUrl": Debugger.SetBreakpointByUrlResponse;
    "Debugger.setBreakpoint": Debugger.SetBreakpointResponse;
    "Debugger.removeBreakpoint": Debugger.RemoveBreakpointResponse;
    "Debugger.addSymbolicBreakpoint": Debugger.AddSymbolicBreakpointResponse;
    "Debugger.removeSymbolicBreakpoint": Debugger.RemoveSymbolicBreakpointResponse;
    "Debugger.continueUntilNextRunLoop": Debugger.ContinueUntilNextRunLoopResponse;
    "Debugger.continueToLocation": Debugger.ContinueToLocationResponse;
    "Debugger.stepNext": Debugger.StepNextResponse;
    "Debugger.stepOver": Debugger.StepOverResponse;
    "Debugger.stepInto": Debugger.StepIntoResponse;
    "Debugger.stepOut": Debugger.StepOutResponse;
    "Debugger.pause": Debugger.PauseResponse;
    "Debugger.resume": Debugger.ResumeResponse;
    "Debugger.searchInContent": Debugger.SearchInContentResponse;
    "Debugger.getScriptSource": Debugger.GetScriptSourceResponse;
    "Debugger.getFunctionDetails": Debugger.GetFunctionDetailsResponse;
    "Debugger.getBreakpointLocations": Debugger.GetBreakpointLocationsResponse;
    "Debugger.setPauseOnDebuggerStatements": Debugger.SetPauseOnDebuggerStatementsResponse;
    "Debugger.setPauseOnExceptions": Debugger.SetPauseOnExceptionsResponse;
    "Debugger.setPauseOnAssertions": Debugger.SetPauseOnAssertionsResponse;
    "Debugger.setPauseOnMicrotasks": Debugger.SetPauseOnMicrotasksResponse;
    "Debugger.setPauseForInternalScripts": Debugger.SetPauseForInternalScriptsResponse;
    "Debugger.evaluateOnCallFrame": Debugger.EvaluateOnCallFrameResponse;
    "Debugger.setShouldBlackboxURL": Debugger.SetShouldBlackboxURLResponse;
    "Debugger.setBlackboxBreakpointEvaluations": Debugger.SetBlackboxBreakpointEvaluationsResponse;
    "Heap.enable": Heap.EnableResponse;
    "Heap.disable": Heap.DisableResponse;
    "Heap.gc": Heap.GcResponse;
    "Heap.snapshot": Heap.SnapshotResponse;
    "Heap.startTracking": Heap.StartTrackingResponse;
    "Heap.stopTracking": Heap.StopTrackingResponse;
    "Heap.getPreview": Heap.GetPreviewResponse;
    "Heap.getRemoteObject": Heap.GetRemoteObjectResponse;
    "Inspector.enable": Inspector.EnableResponse;
    "Inspector.disable": Inspector.DisableResponse;
    "Inspector.initialized": Inspector.InitializedResponse;
    "Network.enable": Network.EnableResponse;
    "Network.disable": Network.DisableResponse;
    "Network.setExtraHTTPHeaders": Network.SetExtraHTTPHeadersResponse;
    "Network.getResponseBody": Network.GetResponseBodyResponse;
    "Network.setResourceCachingDisabled": Network.SetResourceCachingDisabledResponse;
    "Network.loadResource": Network.LoadResourceResponse;
    "Network.getSerializedCertificate": Network.GetSerializedCertificateResponse;
    "Network.resolveWebSocket": Network.ResolveWebSocketResponse;
    "Network.setInterceptionEnabled": Network.SetInterceptionEnabledResponse;
    "Network.addInterception": Network.AddInterceptionResponse;
    "Network.removeInterception": Network.RemoveInterceptionResponse;
    "Network.interceptContinue": Network.InterceptContinueResponse;
    "Network.interceptWithRequest": Network.InterceptWithRequestResponse;
    "Network.interceptWithResponse": Network.InterceptWithResponseResponse;
    "Network.interceptRequestWithResponse": Network.InterceptRequestWithResponseResponse;
    "Network.interceptRequestWithError": Network.InterceptRequestWithErrorResponse;
    "Network.setEmulatedConditions": Network.SetEmulatedConditionsResponse;
    "Runtime.parse": Runtime.ParseResponse;
    "Runtime.evaluate": Runtime.EvaluateResponse;
    "Runtime.awaitPromise": Runtime.AwaitPromiseResponse;
    "Runtime.callFunctionOn": Runtime.CallFunctionOnResponse;
    "Runtime.getPreview": Runtime.GetPreviewResponse;
    "Runtime.getProperties": Runtime.GetPropertiesResponse;
    "Runtime.getDisplayableProperties": Runtime.GetDisplayablePropertiesResponse;
    "Runtime.getCollectionEntries": Runtime.GetCollectionEntriesResponse;
    "Runtime.saveResult": Runtime.SaveResultResponse;
    "Runtime.setSavedResultAlias": Runtime.SetSavedResultAliasResponse;
    "Runtime.releaseObject": Runtime.ReleaseObjectResponse;
    "Runtime.releaseObjectGroup": Runtime.ReleaseObjectGroupResponse;
    "Runtime.enable": Runtime.EnableResponse;
    "Runtime.disable": Runtime.DisableResponse;
    "Runtime.getRuntimeTypesForVariablesAtOffsets": Runtime.GetRuntimeTypesForVariablesAtOffsetsResponse;
    "Runtime.enableTypeProfiler": Runtime.EnableTypeProfilerResponse;
    "Runtime.disableTypeProfiler": Runtime.DisableTypeProfilerResponse;
    "Runtime.enableControlFlowProfiler": Runtime.EnableControlFlowProfilerResponse;
    "Runtime.disableControlFlowProfiler": Runtime.DisableControlFlowProfilerResponse;
    "Runtime.getBasicBlocks": Runtime.GetBasicBlocksResponse;
    "ScriptProfiler.startTracking": ScriptProfiler.StartTrackingResponse;
    "ScriptProfiler.stopTracking": ScriptProfiler.StopTrackingResponse;
  };

  export type Event<T extends keyof EventMap = keyof EventMap> = {
    readonly method: T;
    readonly params: EventMap[T];
  };

  export type Request<T extends keyof RequestMap = keyof RequestMap> = {
    readonly id: number;
    readonly method: T;
    readonly params: RequestMap[T];
  };

  export type Response<T extends keyof ResponseMap = keyof ResponseMap> = {
    readonly id: number;
  } & (
    | {
        readonly method?: T;
        readonly result: ResponseMap[T];
      }
    | {
        readonly error: {
          readonly code?: string;
          readonly message: string;
        };
      }
  );
}
