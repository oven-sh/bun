// GENERATED - DO NOT EDIT
export namespace JSC {
  export namespace Console {
    /** Channels for different types of log messages. */
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
    /** Level of logging. */
    export type ChannelLevel = "off" | "basic" | "verbose";
    /** The reason the console is being cleared. */
    export type ClearReason = "console-api" | "main-frame-navigation";
    /** Logging channel. */
    export type Channel = {
      source: ChannelSource;
      level: ChannelLevel;
    };
    /** Console message. */
    export type ConsoleMessage = {
      source: ChannelSource;
      /** Message severity. */
      level: "log" | "info" | "warning" | "error" | "debug";
      /** Message text. */
      text: string;
      /** Console message type. */
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
        | "image";
      /** URL of the message origin. */
      url?: string;
      /** Line number in the resource that generated this message. */
      line?: number;
      /** Column number on the line in the resource that generated this message. */
      column?: number;
      /** Repeat count for repeated messages. */
      repeatCount?: number;
      /** Message parameters in case of the formatted message. */
      parameters?: Array<Runtime.RemoteObject>;
      /** JavaScript stack trace for assertions and error messages. */
      stackTrace?: StackTrace;
      /** Identifier of the network request associated with this message. */
      networkRequestId?: Network.RequestId;
      /** Time when this message was added. Currently only used when an expensive operation happens to make sure that the frontend can account for it. */
      timestamp?: number;
    };
    /** Stack entry for console errors and assertions. */
    export type CallFrame = {
      /** JavaScript function name. */
      functionName: string;
      /** JavaScript script name or url. */
      url: string;
      /** Script identifier. */
      scriptId: Debugger.ScriptId;
      /** JavaScript script line number. */
      lineNumber: number;
      /** JavaScript script column number. */
      columnNumber: number;
    };
    /** Call frames for async function calls, console assertions, and error messages. */
    export type StackTrace = {
      callFrames: Array<CallFrame>;
      /** Whether the first item in <code>callFrames</code> is the native function that scheduled the asynchronous operation (e.g. setTimeout). */
      topCallFrameIsBoundary?: boolean;
      /** Whether one or more frames have been truncated from the bottom of the stack. */
      truncated?: boolean;
      /** Parent StackTrace. */
      parentStackTrace?: StackTrace;
    };
    /** `Console.messageAdded` */
    export type MessageAddedEvent = {
      /** Console message that has been added. */
      message: ConsoleMessage;
    };
    /** `Console.messageRepeatCountUpdated` */
    export type MessageRepeatCountUpdatedEvent = {
      /** New repeat count value. */
      count: number;
      /** Timestamp of the latest message. */
      timestamp?: number;
    };
    /** `Console.messagesCleared` */
    export type MessagesClearedEvent = {
      /** The reason the console is being cleared. */
      reason: ClearReason;
    };
    /** `Console.heapSnapshot` */
    export type HeapSnapshotEvent = {
      timestamp: number;
      /** Snapshot at the end of tracking. */
      snapshotData: Heap.HeapSnapshotData;
      /** Optional title provided to console.takeHeapSnapshot. */
      title?: string;
    };
    /** `Console.enable` */
    export type EnableRequest = {};
    /** `Console.enable` */
    export type EnableResponse = {};
    /** `Console.disable` */
    export type DisableRequest = {};
    /** `Console.disable` */
    export type DisableResponse = {};
    /** `Console.clearMessages` */
    export type ClearMessagesRequest = {};
    /** `Console.clearMessages` */
    export type ClearMessagesResponse = {};
    /** `Console.getLoggingChannels` */
    export type GetLoggingChannelsRequest = {};
    /** `Console.getLoggingChannels` */
    export type GetLoggingChannelsResponse = {
      /** Logging channels. */
      channels: Array<Channel>;
    };
    /** `Console.setLoggingChannelLevel` */
    export type SetLoggingChannelLevelRequest = {
      /** Logging channel to modify. */
      source: ChannelSource;
      /** New level. */
      level: ChannelLevel;
    };
    /** `Console.setLoggingChannelLevel` */
    export type SetLoggingChannelLevelResponse = {};
  }
  export namespace Debugger {
    /** Breakpoint identifier. */
    export type BreakpointId = string;
    /** Breakpoint action identifier. */
    export type BreakpointActionIdentifier = number;
    /** Unique script identifier. */
    export type ScriptId = string;
    /** Call frame identifier. */
    export type CallFrameId = string;
    /** Location in the source code. */
    export type Location = {
      /** Script identifier as reported in the <code>Debugger.scriptParsed</code>. */
      scriptId: ScriptId;
      /** Line number in the script (0-based). */
      lineNumber: number;
      /** Column number in the script (0-based). */
      columnNumber?: number;
    };
    /** Action to perform when a breakpoint is triggered. */
    export type BreakpointAction = {
      /** Different kinds of breakpoint actions. */
      type: "log" | "evaluate" | "sound" | "probe";
      /** Data associated with this breakpoint type (e.g. for type "eval" this is the JavaScript string to evaluate). */
      data?: string;
      /** A frontend-assigned identifier for this breakpoint action. */
      id?: BreakpointActionIdentifier;
      /** Indicates whether this action should be executed with a user gesture or not. Defaults to <code>false<code>. */
      emulateUserGesture?: boolean;
    };
    /** Extra options that modify breakpoint behavior. */
    export type BreakpointOptions = {
      /** Expression to use as a breakpoint condition. When specified, debugger will only stop on the breakpoint if this expression evaluates to true. */
      condition?: string;
      /** Actions to perform automatically when the breakpoint is triggered. */
      actions?: Array<BreakpointAction>;
      /** Automatically continue after hitting this breakpoint and running actions. */
      autoContinue?: boolean;
      /** Number of times to ignore this breakpoint, before stopping on the breakpoint and running actions. */
      ignoreCount?: number;
    };
    /** Information about the function. */
    export type FunctionDetails = {
      /** Location of the function. */
      location: Location;
      /** Name of the function. Not present for anonymous functions. */
      name?: string;
      /** Display name of the function(specified in 'displayName' property on the function object). */
      displayName?: string;
      /** Scope chain for this closure. */
      scopeChain?: Array<Scope>;
    };
    /** JavaScript call frame. Array of call frames form the call stack. */
    export type CallFrame = {
      /** Call frame identifier. This identifier is only valid while the virtual machine is paused. */
      callFrameId: CallFrameId;
      /** Name of the JavaScript function called on this call frame. */
      functionName: string;
      /** Location in the source code. */
      location: Location;
      /** Scope chain for this call frame. */
      scopeChain: Array<Scope>;
      /** <code>this</code> object for this call frame. */
      this: Runtime.RemoteObject;
      /** Is the current frame tail deleted from a tail call. */
      isTailDeleted: boolean;
    };
    /** Scope description. */
    export type Scope = {
      /** Object representing the scope. For <code>global</code> and <code>with</code> scopes it represents the actual object; for the rest of the scopes, it is artificial transient object enumerating scope variables as its properties. */
      object: Runtime.RemoteObject;
      /** Scope type. */
      type: "global" | "with" | "closure" | "catch" | "functionName" | "globalLexicalEnvironment" | "nestedLexical";
      /** Name associated with the scope. */
      name?: string;
      /** Location if available of the scope definition. */
      location?: Location;
      /** Whether the scope has any variables. */
      empty?: boolean;
    };
    /** A sample collected by evaluating a probe breakpoint action. */
    export type ProbeSample = {
      /** Identifier of the probe breakpoint action that created the sample. */
      probeId: BreakpointActionIdentifier;
      /** Unique identifier for this sample. */
      sampleId: number;
      /** A batch identifier which is the same for all samples taken at the same breakpoint hit. */
      batchId: number;
      /** Timestamp of when the sample was taken. */
      timestamp: number;
      /** Contents of the sample. */
      payload: Runtime.RemoteObject;
    };
    /** The pause reason auxiliary data when paused because of an assertion. */
    export type AssertPauseReason = {
      /** The console.assert message string if provided. */
      message?: string;
    };
    /** The pause reason auxiliary data when paused because of hitting a breakpoint. */
    export type BreakpointPauseReason = {
      /** The identifier of the breakpoint causing the pause. */
      breakpointId: string;
    };
    /** The pause reason auxiliary data when paused because of a Content Security Policy directive. */
    export type CSPViolationPauseReason = {
      /** The CSP directive that blocked script execution. */
      directive: string;
    };
    /** `Debugger.globalObjectCleared` */
    export type GlobalObjectClearedEvent = {};
    /** `Debugger.scriptParsed` */
    export type ScriptParsedEvent = {
      /** Identifier of the script parsed. */
      scriptId: ScriptId;
      /** URL of the script parsed (if any). */
      url: string;
      /** Line offset of the script within the resource with given URL (for script tags). */
      startLine: number;
      /** Column offset of the script within the resource with given URL. */
      startColumn: number;
      /** Last line of the script. */
      endLine: number;
      /** Length of the last line of the script. */
      endColumn: number;
      /** Determines whether this script is a user extension script. */
      isContentScript?: boolean;
      /** sourceURL name of the script (if any). */
      sourceURL?: string;
      /** URL of source map associated with script (if any). */
      sourceMapURL?: string;
      /** True if this script was parsed as a module. */
      module?: boolean;
    };
    /** `Debugger.scriptFailedToParse` */
    export type ScriptFailedToParseEvent = {
      /** URL of the script that failed to parse. */
      url: string;
      /** Source text of the script that failed to parse. */
      scriptSource: string;
      /** Line offset of the script within the resource. */
      startLine: number;
      /** Line with error. */
      errorLine: number;
      /** Parse error message. */
      errorMessage: string;
    };
    /** `Debugger.breakpointResolved` */
    export type BreakpointResolvedEvent = {
      /** Breakpoint unique identifier. */
      breakpointId: BreakpointId;
      /** Actual breakpoint location. */
      location: Location;
    };
    /** `Debugger.paused` */
    export type PausedEvent = {
      /** Call stack the virtual machine stopped on. */
      callFrames: Array<CallFrame>;
      /** Pause reason. */
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
      /** Object containing break-specific auxiliary properties. */
      data?: Record<string, unknown>;
      /** Linked list of asynchronous StackTraces. */
      asyncStackTrace?: Console.StackTrace;
    };
    /** `Debugger.resumed` */
    export type ResumedEvent = {};
    /** `Debugger.didSampleProbe` */
    export type DidSampleProbeEvent = {
      /** A collected probe sample. */
      sample: ProbeSample;
    };
    /** `Debugger.playBreakpointActionSound` */
    export type PlayBreakpointActionSoundEvent = {
      /** Breakpoint action identifier. */
      breakpointActionId: BreakpointActionIdentifier;
    };
    /** `Debugger.enable` */
    export type EnableRequest = {};
    /** `Debugger.enable` */
    export type EnableResponse = {};
    /** `Debugger.disable` */
    export type DisableRequest = {};
    /** `Debugger.disable` */
    export type DisableResponse = {};
    /** `Debugger.setAsyncStackTraceDepth` */
    export type SetAsyncStackTraceDepthRequest = {
      /** Async stack trace depth. */
      depth: number;
    };
    /** `Debugger.setAsyncStackTraceDepth` */
    export type SetAsyncStackTraceDepthResponse = {};
    /** `Debugger.setBreakpointsActive` */
    export type SetBreakpointsActiveRequest = {
      /** New value for breakpoints active state. */
      active: boolean;
    };
    /** `Debugger.setBreakpointsActive` */
    export type SetBreakpointsActiveResponse = {};
    /** `Debugger.setBreakpointByUrl` */
    export type SetBreakpointByUrlRequest = {
      /** Line number to set breakpoint at. */
      lineNumber: number;
      /** URL of the resources to set breakpoint on. */
      url?: string;
      /** Regex pattern for the URLs of the resources to set breakpoints on. Either <code>url</code> or <code>urlRegex</code> must be specified. */
      urlRegex?: string;
      /** Offset in the line to set breakpoint at. */
      columnNumber?: number;
      /** Options to apply to this breakpoint to modify its behavior. */
      options?: BreakpointOptions;
    };
    /** `Debugger.setBreakpointByUrl` */
    export type SetBreakpointByUrlResponse = {
      /** Id of the created breakpoint for further reference. */
      breakpointId: BreakpointId;
      /** List of the locations this breakpoint resolved into upon addition. */
      locations: Array<Location>;
    };
    /** `Debugger.setBreakpoint` */
    export type SetBreakpointRequest = {
      /** Location to set breakpoint in. */
      location: Location;
      /** Options to apply to this breakpoint to modify its behavior. */
      options?: BreakpointOptions;
    };
    /** `Debugger.setBreakpoint` */
    export type SetBreakpointResponse = {
      /** Id of the created breakpoint for further reference. */
      breakpointId: BreakpointId;
      /** Location this breakpoint resolved into. */
      actualLocation: Location;
    };
    /** `Debugger.removeBreakpoint` */
    export type RemoveBreakpointRequest = {
      breakpointId: BreakpointId;
    };
    /** `Debugger.removeBreakpoint` */
    export type RemoveBreakpointResponse = {};
    /** `Debugger.addSymbolicBreakpoint` */
    export type AddSymbolicBreakpointRequest = {
      /** The name of the function to pause in when called. */
      symbol: string;
      /** If true, symbol is case sensitive. Defaults to true. */
      caseSensitive?: boolean;
      /** If true, treats symbol as a regex. Defaults to false. */
      isRegex?: boolean;
      /** Options to apply to this breakpoint to modify its behavior. */
      options?: BreakpointOptions;
    };
    /** `Debugger.addSymbolicBreakpoint` */
    export type AddSymbolicBreakpointResponse = {};
    /** `Debugger.removeSymbolicBreakpoint` */
    export type RemoveSymbolicBreakpointRequest = {
      /** The name of the function to pause in when called. */
      symbol: string;
      /** If true, symbol is case sensitive. Defaults to true. */
      caseSensitive?: boolean;
      /** If true, treats symbol as a regex. Defaults to false. */
      isRegex?: boolean;
    };
    /** `Debugger.removeSymbolicBreakpoint` */
    export type RemoveSymbolicBreakpointResponse = {};
    /** `Debugger.continueUntilNextRunLoop` */
    export type ContinueUntilNextRunLoopRequest = {};
    /** `Debugger.continueUntilNextRunLoop` */
    export type ContinueUntilNextRunLoopResponse = {};
    /** `Debugger.continueToLocation` */
    export type ContinueToLocationRequest = {
      /** Location to continue to. */
      location: Location;
    };
    /** `Debugger.continueToLocation` */
    export type ContinueToLocationResponse = {};
    /** `Debugger.stepNext` */
    export type StepNextRequest = {};
    /** `Debugger.stepNext` */
    export type StepNextResponse = {};
    /** `Debugger.stepOver` */
    export type StepOverRequest = {};
    /** `Debugger.stepOver` */
    export type StepOverResponse = {};
    /** `Debugger.stepInto` */
    export type StepIntoRequest = {};
    /** `Debugger.stepInto` */
    export type StepIntoResponse = {};
    /** `Debugger.stepOut` */
    export type StepOutRequest = {};
    /** `Debugger.stepOut` */
    export type StepOutResponse = {};
    /** `Debugger.pause` */
    export type PauseRequest = {};
    /** `Debugger.pause` */
    export type PauseResponse = {};
    /** `Debugger.resume` */
    export type ResumeRequest = {};
    /** `Debugger.resume` */
    export type ResumeResponse = {};
    /** `Debugger.searchInContent` */
    export type SearchInContentRequest = {
      /** Id of the script to search in. */
      scriptId: ScriptId;
      /** String to search for. */
      query: string;
      /** If true, search is case sensitive. */
      caseSensitive?: boolean;
      /** If true, treats string parameter as regex. */
      isRegex?: boolean;
    };
    /** `Debugger.searchInContent` */
    export type SearchInContentResponse = {
      /** List of search matches. */
      result: Array<GenericTypes.SearchMatch>;
    };
    /** `Debugger.getScriptSource` */
    export type GetScriptSourceRequest = {
      /** Id of the script to get source for. */
      scriptId: ScriptId;
    };
    /** `Debugger.getScriptSource` */
    export type GetScriptSourceResponse = {
      /** Script source. */
      scriptSource: string;
    };
    /** `Debugger.getFunctionDetails` */
    export type GetFunctionDetailsRequest = {
      /** Id of the function to get location for. */
      functionId: Runtime.RemoteObjectId;
    };
    /** `Debugger.getFunctionDetails` */
    export type GetFunctionDetailsResponse = {
      /** Information about the function. */
      details: FunctionDetails;
    };
    /** `Debugger.getBreakpointLocations` */
    export type GetBreakpointLocationsRequest = {
      /** Starting location to look for breakpoint locations after (inclusive). Must have same scriptId as end. */
      start: Location;
      /** Ending location to look for breakpoint locations before (exclusive). Must have same scriptId as start. */
      end: Location;
    };
    /** `Debugger.getBreakpointLocations` */
    export type GetBreakpointLocationsResponse = {
      /** List of resolved breakpoint locations. */
      locations: Array<Location>;
    };
    /** `Debugger.setPauseOnDebuggerStatements` */
    export type SetPauseOnDebuggerStatementsRequest = {
      enabled: boolean;
      /** Options to apply to this breakpoint to modify its behavior. */
      options?: BreakpointOptions;
    };
    /** `Debugger.setPauseOnDebuggerStatements` */
    export type SetPauseOnDebuggerStatementsResponse = {};
    /** `Debugger.setPauseOnExceptions` */
    export type SetPauseOnExceptionsRequest = {
      /** Pause on exceptions mode. */
      state: "none" | "uncaught" | "all";
      /** Options to apply to this breakpoint to modify its behavior. */
      options?: BreakpointOptions;
    };
    /** `Debugger.setPauseOnExceptions` */
    export type SetPauseOnExceptionsResponse = {};
    /** `Debugger.setPauseOnAssertions` */
    export type SetPauseOnAssertionsRequest = {
      enabled: boolean;
      /** Options to apply to this breakpoint to modify its behavior. */
      options?: BreakpointOptions;
    };
    /** `Debugger.setPauseOnAssertions` */
    export type SetPauseOnAssertionsResponse = {};
    /** `Debugger.setPauseOnMicrotasks` */
    export type SetPauseOnMicrotasksRequest = {
      enabled: boolean;
      /** Options to apply to this breakpoint to modify its behavior. */
      options?: BreakpointOptions;
    };
    /** `Debugger.setPauseOnMicrotasks` */
    export type SetPauseOnMicrotasksResponse = {};
    /** `Debugger.setPauseForInternalScripts` */
    export type SetPauseForInternalScriptsRequest = {
      shouldPause: boolean;
    };
    /** `Debugger.setPauseForInternalScripts` */
    export type SetPauseForInternalScriptsResponse = {};
    /** `Debugger.evaluateOnCallFrame` */
    export type EvaluateOnCallFrameRequest = {
      /** Call frame identifier to evaluate on. */
      callFrameId: CallFrameId;
      /** Expression to evaluate. */
      expression: string;
      /** String object group name to put result into (allows rapid releasing resulting object handles using <code>releaseObjectGroup</code>). */
      objectGroup?: string;
      /** Specifies whether command line API should be available to the evaluated expression, defaults to false. */
      includeCommandLineAPI?: boolean;
      /** Specifies whether evaluation should stop on exceptions and mute console. Overrides setPauseOnException state. */
      doNotPauseOnExceptionsAndMuteConsole?: boolean;
      /** Whether the result is expected to be a JSON object that should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
      /** Whether the resulting value should be considered for saving in the $n history. */
      saveResult?: boolean;
      /** Whether the expression should be considered to be in a user gesture or not. */
      emulateUserGesture?: boolean;
    };
    /** `Debugger.evaluateOnCallFrame` */
    export type EvaluateOnCallFrameResponse = {
      /** Object wrapper for the evaluation result. */
      result: Runtime.RemoteObject;
      /** True if the result was thrown during the evaluation. */
      wasThrown?: boolean;
      /** If the result was saved, this is the $n index that can be used to access the value. */
      savedResultIndex?: number;
    };
    /** `Debugger.setShouldBlackboxURL` */
    export type SetShouldBlackboxURLRequest = {
      url: string;
      shouldBlackbox: boolean;
      /** If true, <code>url</code> is case sensitive. */
      caseSensitive?: boolean;
      /** If true, treat <code>url</code> as regular expression. */
      isRegex?: boolean;
    };
    /** `Debugger.setShouldBlackboxURL` */
    export type SetShouldBlackboxURLResponse = {};
    /** `Debugger.setBlackboxBreakpointEvaluations` */
    export type SetBlackboxBreakpointEvaluationsRequest = {
      blackboxBreakpointEvaluations: boolean;
    };
    /** `Debugger.setBlackboxBreakpointEvaluations` */
    export type SetBlackboxBreakpointEvaluationsResponse = {};
  }
  export namespace GenericTypes {
    /** Search match in a resource. */
    export type SearchMatch = {
      /** Line number in resource content. */
      lineNumber: number;
      /** Line with match content. */
      lineContent: string;
    };
  }
  export namespace Heap {
    /** Information about a garbage collection. */
    export type GarbageCollection = {
      /** The type of garbage collection. */
      type: "full" | "partial";
      startTime: number;
      endTime: number;
    };
    /** JavaScriptCore HeapSnapshot JSON data. */
    export type HeapSnapshotData = string;
    /** `Heap.garbageCollected` */
    export type GarbageCollectedEvent = {
      collection: GarbageCollection;
    };
    /** `Heap.trackingStart` */
    export type TrackingStartEvent = {
      timestamp: number;
      /** Snapshot at the start of tracking. */
      snapshotData: HeapSnapshotData;
    };
    /** `Heap.trackingComplete` */
    export type TrackingCompleteEvent = {
      timestamp: number;
      /** Snapshot at the end of tracking. */
      snapshotData: HeapSnapshotData;
    };
    /** `Heap.enable` */
    export type EnableRequest = {};
    /** `Heap.enable` */
    export type EnableResponse = {};
    /** `Heap.disable` */
    export type DisableRequest = {};
    /** `Heap.disable` */
    export type DisableResponse = {};
    /** `Heap.gc` */
    export type GcRequest = {};
    /** `Heap.gc` */
    export type GcResponse = {};
    /** `Heap.snapshot` */
    export type SnapshotRequest = {};
    /** `Heap.snapshot` */
    export type SnapshotResponse = {
      timestamp: number;
      snapshotData: HeapSnapshotData;
    };
    /** `Heap.startTracking` */
    export type StartTrackingRequest = {};
    /** `Heap.startTracking` */
    export type StartTrackingResponse = {};
    /** `Heap.stopTracking` */
    export type StopTrackingRequest = {};
    /** `Heap.stopTracking` */
    export type StopTrackingResponse = {};
    /** `Heap.getPreview` */
    export type GetPreviewRequest = {
      /** Identifier of the heap object within the snapshot. */
      heapObjectId: number;
    };
    /** `Heap.getPreview` */
    export type GetPreviewResponse = {
      /** String value. */
      string?: string;
      /** Function details. */
      functionDetails?: Debugger.FunctionDetails;
      /** Object preview. */
      preview?: Runtime.ObjectPreview;
    };
    /** `Heap.getRemoteObject` */
    export type GetRemoteObjectRequest = {
      /** Identifier of the heap object within the snapshot. */
      heapObjectId: number;
      /** Symbolic group name that can be used to release multiple objects. */
      objectGroup?: string;
    };
    /** `Heap.getRemoteObject` */
    export type GetRemoteObjectResponse = {
      /** Resulting object. */
      result: Runtime.RemoteObject;
    };
  }
  export namespace Network {
    /** Unique loader identifier. */
    export type LoaderId = string;
    /** Unique frame identifier. */
    export type FrameId = string;
    /** Unique request identifier. */
    export type RequestId = string;
    /** Elapsed seconds since frontend connected. */
    export type Timestamp = number;
    /** Number of seconds since epoch. */
    export type Walltime = number;
    /** Controls how much referrer information is sent with the request */
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
    /** Request / response headers as keys / values of JSON object. */
    export type Headers = Record<string, unknown>;
    /** Timing information for the request. */
    export type ResourceTiming = {
      /** Request is initiated */
      startTime: Timestamp;
      /** Started redirect resolution. */
      redirectStart: Timestamp;
      /** Finished redirect resolution. */
      redirectEnd: Timestamp;
      /** Resource fetching started. */
      fetchStart: Timestamp;
      /** Started DNS address resolve in milliseconds relative to fetchStart. */
      domainLookupStart: number;
      /** Finished DNS address resolve in milliseconds relative to fetchStart. */
      domainLookupEnd: number;
      /** Started connecting to the remote host in milliseconds relative to fetchStart. */
      connectStart: number;
      /** Connected to the remote host in milliseconds relative to fetchStart. */
      connectEnd: number;
      /** Started SSL handshake in milliseconds relative to fetchStart. */
      secureConnectionStart: number;
      /** Started sending request in milliseconds relative to fetchStart. */
      requestStart: number;
      /** Started receiving response headers in milliseconds relative to fetchStart. */
      responseStart: number;
      /** Finished receiving response headers in milliseconds relative to fetchStart. */
      responseEnd: number;
    };
    /** HTTP request data. */
    export type Request = {
      /** Request URL. */
      url: string;
      /** HTTP request method. */
      method: string;
      /** HTTP request headers. */
      headers: Headers;
      /** HTTP POST request data. */
      postData?: string;
      /** The level of included referrer information. */
      referrerPolicy?: ReferrerPolicy;
      /** The base64 cryptographic hash of the resource. */
      integrity?: string;
    };
    /** HTTP response data. */
    export type Response = {
      /** Response URL. This URL can be different from CachedResource.url in case of redirect. */
      url: string;
      /** HTTP response status code. */
      status: number;
      /** HTTP response status text. */
      statusText: string;
      /** HTTP response headers. */
      headers: Headers;
      /** Resource mimeType as determined by the browser. */
      mimeType: string;
      /** Specifies where the response came from. */
      source: "unknown" | "network" | "memory-cache" | "disk-cache" | "service-worker" | "inspector-override";
      /** Refined HTTP request headers that were actually transmitted over the network. */
      requestHeaders?: Headers;
      /** Timing information for the given request. */
      timing?: ResourceTiming;
      /** The security information for the given request. */
      security?: unknown;
    };
    /** Network load metrics. */
    export type Metrics = {
      /** Network protocol. ALPN Protocol ID Identification Sequence, as per RFC 7301 (for example, http/2, http/1.1, spdy/3.1) */
      protocol?: string;
      /** Network priority. */
      priority?: "low" | "medium" | "high";
      /** Connection identifier. */
      connectionIdentifier?: string;
      /** Remote IP address. */
      remoteAddress?: string;
      /** Refined HTTP request headers that were actually transmitted over the network. */
      requestHeaders?: Headers;
      /** Total HTTP request header bytes sent over the network. */
      requestHeaderBytesSent?: number;
      /** Total HTTP request body bytes sent over the network. */
      requestBodyBytesSent?: number;
      /** Total HTTP response header bytes received over the network. */
      responseHeaderBytesReceived?: number;
      /** Total HTTP response body bytes received over the network. */
      responseBodyBytesReceived?: number;
      /** Total decoded response body size in bytes. */
      responseBodyDecodedSize?: number;
      /** Connection information for the completed request. */
      securityConnection?: unknown;
      /** Whether or not the connection was proxied through a server. If <code>true</code>, the <code>remoteAddress</code> will be for the proxy server, not the server that provided the resource to the proxy server. */
      isProxyConnection?: boolean;
    };
    /** WebSocket request data. */
    export type WebSocketRequest = {
      /** HTTP response headers. */
      headers: Headers;
    };
    /** WebSocket response data. */
    export type WebSocketResponse = {
      /** HTTP response status code. */
      status: number;
      /** HTTP response status text. */
      statusText: string;
      /** HTTP response headers. */
      headers: Headers;
    };
    /** WebSocket frame data. */
    export type WebSocketFrame = {
      /** WebSocket frame opcode. */
      opcode: number;
      /** WebSocket frame mask. */
      mask: boolean;
      /** WebSocket frame payload data, binary frames (opcode = 2) are base64-encoded. */
      payloadData: string;
      /** WebSocket frame payload length in bytes. */
      payloadLength: number;
    };
    /** Information about the cached resource. */
    export type CachedResource = {
      /** Resource URL. This is the url of the original network request. */
      url: string;
      /** Type of this resource. */
      type: unknown;
      /** Cached response data. */
      response?: Response;
      /** Cached response body size. */
      bodySize: number;
      /** URL of source map associated with this resource (if any). */
      sourceMapURL?: string;
    };
    /** Information about the request initiator. */
    export type Initiator = {
      /** Type of this initiator. */
      type: "parser" | "script" | "other";
      /** Initiator JavaScript stack trace, set for Script only. */
      stackTrace?: Console.StackTrace;
      /** Initiator URL, set for Parser type only. */
      url?: string;
      /** Initiator line number, set for Parser type only. */
      lineNumber?: number;
      /** Set if the load was triggered by a DOM node, in addition to the other initiator information. */
      nodeId?: unknown;
    };
    /** Different stages of a network request. */
    export type NetworkStage = "request" | "response";
    /** Different stages of a network request. */
    export type ResourceErrorType = "General" | "AccessControl" | "Cancellation" | "Timeout";
    /** `Network.requestWillBeSent` */
    export type RequestWillBeSentEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Frame identifier. */
      frameId: FrameId;
      /** Loader identifier. */
      loaderId: LoaderId;
      /** URL of the document this request is loaded for. */
      documentURL: string;
      /** Request data. */
      request: Request;
      timestamp: Timestamp;
      walltime: Walltime;
      /** Request initiator. */
      initiator: Initiator;
      /** Redirect response data. */
      redirectResponse?: Response;
      /** Resource type. */
      type?: unknown;
      /** Identifier for the context of where the load originated. In general this is the target identifier. For Workers this will be the workerId. */
      targetId?: string;
    };
    /** `Network.responseReceived` */
    export type ResponseReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Frame identifier. */
      frameId: FrameId;
      /** Loader identifier. */
      loaderId: LoaderId;
      /** Timestamp. */
      timestamp: Timestamp;
      /** Resource type. */
      type: unknown;
      /** Response data. */
      response: Response;
    };
    /** `Network.dataReceived` */
    export type DataReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: Timestamp;
      /** Data chunk length. */
      dataLength: number;
      /** Actual bytes received (might be less than dataLength for compressed encodings). */
      encodedDataLength: number;
    };
    /** `Network.loadingFinished` */
    export type LoadingFinishedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: Timestamp;
      /** URL of source map associated with this resource (if any). */
      sourceMapURL?: string;
      /** Network metrics. */
      metrics?: Metrics;
    };
    /** `Network.loadingFailed` */
    export type LoadingFailedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: Timestamp;
      /** User friendly error message. */
      errorText: string;
      /** True if loading was canceled. */
      canceled?: boolean;
    };
    /** `Network.requestServedFromMemoryCache` */
    export type RequestServedFromMemoryCacheEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Frame identifier. */
      frameId: FrameId;
      /** Loader identifier. */
      loaderId: LoaderId;
      /** URL of the document this request is loaded for. */
      documentURL: string;
      /** Timestamp. */
      timestamp: Timestamp;
      /** Request initiator. */
      initiator: Initiator;
      /** Cached resource data. */
      resource: CachedResource;
    };
    /** `Network.requestIntercepted` */
    export type RequestInterceptedEvent = {
      /** Identifier for this intercepted network. Corresponds with an earlier <code>Network.requestWillBeSent</code>. */
      requestId: RequestId;
      /** Original request content that would proceed if this is continued. */
      request: Request;
    };
    /** `Network.responseIntercepted` */
    export type ResponseInterceptedEvent = {
      /** Identifier for this intercepted network. Corresponds with an earlier <code>Network.requestWillBeSent</code>. */
      requestId: RequestId;
      /** Original response content that would proceed if this is continued. */
      response: Response;
    };
    /** `Network.webSocketWillSendHandshakeRequest` */
    export type WebSocketWillSendHandshakeRequestEvent = {
      /** Request identifier. */
      requestId: RequestId;
      timestamp: Timestamp;
      walltime: Walltime;
      /** WebSocket request data. */
      request: WebSocketRequest;
    };
    /** `Network.webSocketHandshakeResponseReceived` */
    export type WebSocketHandshakeResponseReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      timestamp: Timestamp;
      /** WebSocket response data. */
      response: WebSocketResponse;
    };
    /** `Network.webSocketCreated` */
    export type WebSocketCreatedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** WebSocket request URL. */
      url: string;
    };
    /** `Network.webSocketClosed` */
    export type WebSocketClosedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: Timestamp;
    };
    /** `Network.webSocketFrameReceived` */
    export type WebSocketFrameReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: Timestamp;
      /** WebSocket response data. */
      response: WebSocketFrame;
    };
    /** `Network.webSocketFrameError` */
    export type WebSocketFrameErrorEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: Timestamp;
      /** WebSocket frame error message. */
      errorMessage: string;
    };
    /** `Network.webSocketFrameSent` */
    export type WebSocketFrameSentEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: Timestamp;
      /** WebSocket response data. */
      response: WebSocketFrame;
    };
    /** `Network.enable` */
    export type EnableRequest = {};
    /** `Network.enable` */
    export type EnableResponse = {};
    /** `Network.disable` */
    export type DisableRequest = {};
    /** `Network.disable` */
    export type DisableResponse = {};
    /** `Network.setExtraHTTPHeaders` */
    export type SetExtraHTTPHeadersRequest = {
      /** Map with extra HTTP headers. */
      headers: Headers;
    };
    /** `Network.setExtraHTTPHeaders` */
    export type SetExtraHTTPHeadersResponse = {};
    /** `Network.getResponseBody` */
    export type GetResponseBodyRequest = {
      /** Identifier of the network request to get content for. */
      requestId: RequestId;
    };
    /** `Network.getResponseBody` */
    export type GetResponseBodyResponse = {
      /** Response body. */
      body: string;
      /** True, if content was sent as base64. */
      base64Encoded: boolean;
    };
    /** `Network.setResourceCachingDisabled` */
    export type SetResourceCachingDisabledRequest = {
      /** Whether to prevent usage of the resource cache. */
      disabled: boolean;
    };
    /** `Network.setResourceCachingDisabled` */
    export type SetResourceCachingDisabledResponse = {};
    /** `Network.loadResource` */
    export type LoadResourceRequest = {
      /** Frame to load the resource from. */
      frameId: FrameId;
      /** URL of the resource to load. */
      url: string;
    };
    /** `Network.loadResource` */
    export type LoadResourceResponse = {
      /** Resource content. */
      content: string;
      /** Resource mimeType. */
      mimeType: string;
      /** HTTP response status code. */
      status: number;
    };
    /** `Network.getSerializedCertificate` */
    export type GetSerializedCertificateRequest = {
      requestId: RequestId;
    };
    /** `Network.getSerializedCertificate` */
    export type GetSerializedCertificateResponse = {
      /** Represents a base64 encoded WebCore::CertificateInfo object. */
      serializedCertificate: string;
    };
    /** `Network.resolveWebSocket` */
    export type ResolveWebSocketRequest = {
      /** Identifier of the WebSocket resource to resolve. */
      requestId: RequestId;
      /** Symbolic group name that can be used to release multiple objects. */
      objectGroup?: string;
    };
    /** `Network.resolveWebSocket` */
    export type ResolveWebSocketResponse = {
      /** JavaScript object wrapper for given node. */
      object: Runtime.RemoteObject;
    };
    /** `Network.setInterceptionEnabled` */
    export type SetInterceptionEnabledRequest = {
      enabled: boolean;
    };
    /** `Network.setInterceptionEnabled` */
    export type SetInterceptionEnabledResponse = {};
    /** `Network.addInterception` */
    export type AddInterceptionRequest = {
      /** URL pattern to intercept, intercept everything if not specified or empty */
      url: string;
      /** Stage to intercept. */
      stage: NetworkStage;
      /** If false, ignores letter casing of `url` parameter. */
      caseSensitive?: boolean;
      /** If true, treats `url` parameter as a regular expression. */
      isRegex?: boolean;
    };
    /** `Network.addInterception` */
    export type AddInterceptionResponse = {};
    /** `Network.removeInterception` */
    export type RemoveInterceptionRequest = {
      url: string;
      /** Stage to intercept. */
      stage: NetworkStage;
      /** If false, ignores letter casing of `url` parameter. */
      caseSensitive?: boolean;
      /** If true, treats `url` parameter as a regular expression. */
      isRegex?: boolean;
    };
    /** `Network.removeInterception` */
    export type RemoveInterceptionResponse = {};
    /** `Network.interceptContinue` */
    export type InterceptContinueRequest = {
      /** Identifier for the intercepted Network request or response to continue. */
      requestId: RequestId;
      /** Stage to continue. */
      stage: NetworkStage;
    };
    /** `Network.interceptContinue` */
    export type InterceptContinueResponse = {};
    /** `Network.interceptWithRequest` */
    export type InterceptWithRequestRequest = {
      /** Identifier for the intercepted Network request or response to continue. */
      requestId: RequestId;
      /** HTTP request url. */
      url?: string;
      /** HTTP request method. */
      method?: string;
      /** HTTP response headers. Pass through original values if unmodified. */
      headers?: Headers;
      /** HTTP POST request data, base64-encoded. */
      postData?: string;
    };
    /** `Network.interceptWithRequest` */
    export type InterceptWithRequestResponse = {};
    /** `Network.interceptWithResponse` */
    export type InterceptWithResponseRequest = {
      /** Identifier for the intercepted Network response to modify. */
      requestId: RequestId;
      content: string;
      /** True, if content was sent as base64. */
      base64Encoded: boolean;
      /** MIME Type for the data. */
      mimeType?: string;
      /** HTTP response status code. Pass through original values if unmodified. */
      status?: number;
      /** HTTP response status text. Pass through original values if unmodified. */
      statusText?: string;
      /** HTTP response headers. Pass through original values if unmodified. */
      headers?: Headers;
    };
    /** `Network.interceptWithResponse` */
    export type InterceptWithResponseResponse = {};
    /** `Network.interceptRequestWithResponse` */
    export type InterceptRequestWithResponseRequest = {
      /** Identifier for the intercepted Network response to modify. */
      requestId: RequestId;
      content: string;
      /** True, if content was sent as base64. */
      base64Encoded: boolean;
      /** MIME Type for the data. */
      mimeType: string;
      /** HTTP response status code. */
      status: number;
      /** HTTP response status text. */
      statusText: string;
      /** HTTP response headers. */
      headers: Headers;
    };
    /** `Network.interceptRequestWithResponse` */
    export type InterceptRequestWithResponseResponse = {};
    /** `Network.interceptRequestWithError` */
    export type InterceptRequestWithErrorRequest = {
      /** Identifier for the intercepted Network request to fail. */
      requestId: RequestId;
      /** Deliver error reason for the request failure. */
      errorType: ResourceErrorType;
    };
    /** `Network.interceptRequestWithError` */
    export type InterceptRequestWithErrorResponse = {};
    /** `Network.setEmulatedConditions` */
    export type SetEmulatedConditionsRequest = {
      /** Limits the bytes per second of requests if positive. Removes any limits if zero or not provided. */
      bytesPerSecondLimit?: number;
    };
    /** `Network.setEmulatedConditions` */
    export type SetEmulatedConditionsResponse = {};
  }
  export namespace Runtime {
    /** Unique object identifier. */
    export type RemoteObjectId = string;
    /** Mirror object referencing original JavaScript object. */
    export type RemoteObject = {
      /** Object type. */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
      /** Object subtype hint. Specified for <code>object</code> <code>function</code> (for class) type values only. */
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
        | "proxy";
      /** Object class (constructor) name. Specified for <code>object</code> type values only. */
      className?: string;
      /** Remote object value (in case of primitive values or JSON values if it was requested). */
      value?: any;
      /** String representation of the object. */
      description?: string;
      /** Unique object identifier (for non-primitive values). */
      objectId?: RemoteObjectId;
      /** Size of the array/collection. Specified for array/map/set/weakmap/weakset object type values only. */
      size?: number;
      /** Remote object for the class prototype. Specified for class object type values only. */
      classPrototype?: RemoteObject;
      /** Preview containing abbreviated property values. Specified for <code>object</code> type values only. */
      preview?: ObjectPreview;
    };
    /** Object containing abbreviated remote object value. */
    export type ObjectPreview = {
      /** Object type. */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
      /** Object subtype hint. Specified for <code>object</code> type values only. */
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
        | "proxy";
      /** String representation of the object. */
      description?: string;
      /** Determines whether preview is lossless (contains all information of the original object). */
      lossless: boolean;
      /** True iff some of the properties of the original did not fit. */
      overflow?: boolean;
      /** List of the properties. */
      properties?: Array<PropertyPreview>;
      /** List of the entries. Specified for <code>map</code> and <code>set</code> subtype values only. */
      entries?: Array<EntryPreview>;
      /** Size of the array/collection. Specified for array/map/set/weakmap/weakset object type values only. */
      size?: number;
    };
    export type PropertyPreview = {
      /** Property name. */
      name: string;
      /** Object type. */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint" | "accessor";
      /** Object subtype hint. Specified for <code>object</code> type values only. */
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
        | "proxy";
      /** User-friendly property value string. */
      value?: string;
      /** Nested value preview. */
      valuePreview?: ObjectPreview;
      /** True if this is an internal property. */
      internal?: boolean;
    };
    export type EntryPreview = {
      /** Entry key. Specified for map-like collection entries. */
      key?: ObjectPreview;
      /** Entry value. */
      value: ObjectPreview;
    };
    export type CollectionEntry = {
      /** Entry key of a map-like collection, otherwise not provided. */
      key?: Runtime.RemoteObject;
      /** Entry value. */
      value: Runtime.RemoteObject;
    };
    /** Object property descriptor. */
    export type PropertyDescriptor = {
      /** Property name or symbol description. */
      name: string;
      /** The value associated with the property. */
      value?: RemoteObject;
      /** True if the value associated with the property may be changed (data descriptors only). */
      writable?: boolean;
      /** A function which serves as a getter for the property, or <code>undefined</code> if there is no getter (accessor descriptors only). */
      get?: RemoteObject;
      /** A function which serves as a setter for the property, or <code>undefined</code> if there is no setter (accessor descriptors only). */
      set?: RemoteObject;
      /** True if the result was thrown during the evaluation. */
      wasThrown?: boolean;
      /** True if the type of this property descriptor may be changed and if the property may be deleted from the corresponding object. */
      configurable?: boolean;
      /** True if this property shows up during enumeration of the properties on the corresponding object. */
      enumerable?: boolean;
      /** True if the property is owned for the object. */
      isOwn?: boolean;
      /** Property symbol object, if the property is a symbol. */
      symbol?: Runtime.RemoteObject;
      /** True if the property value came from a native getter. */
      nativeGetter?: boolean;
    };
    /** Object internal property descriptor. This property isn't normally visible in JavaScript code. */
    export type InternalPropertyDescriptor = {
      /** Conventional property name. */
      name: string;
      /** The value associated with the property. */
      value?: RemoteObject;
    };
    /** Represents function call argument. Either remote object id <code>objectId</code> or primitive <code>value</code> or neither of (for undefined) them should be specified. */
    export type CallArgument = {
      /** Primitive value. */
      value?: any;
      /** Remote object handle. */
      objectId?: RemoteObjectId;
    };
    /** Id of an execution context. */
    export type ExecutionContextId = number;
    /** Type of the execution context. */
    export type ExecutionContextType = "normal" | "user" | "internal";
    /** Description of an isolated world. */
    export type ExecutionContextDescription = {
      /** Unique id of the execution context. It can be used to specify in which execution context script evaluation should be performed. */
      id: ExecutionContextId;
      type: ExecutionContextType;
      /** Human readable name describing given context. */
      name: string;
      /** Id of the owning frame. */
      frameId: Network.FrameId;
    };
    /** Syntax error type: "none" for no error, "irrecoverable" for unrecoverable errors, "unterminated-literal" for when there is an unterminated literal, "recoverable" for when the expression is unfinished but valid so far. */
    export type SyntaxErrorType = "none" | "irrecoverable" | "unterminated-literal" | "recoverable";
    /** Range of an error in source code. */
    export type ErrorRange = {
      /** Start offset of range (inclusive). */
      startOffset: number;
      /** End offset of range (exclusive). */
      endOffset: number;
    };
    export type StructureDescription = {
      /** Array of strings, where the strings represent object properties. */
      fields?: Array<string>;
      /** Array of strings, where the strings represent optional object properties. */
      optionalFields?: Array<string>;
      /** Name of the constructor. */
      constructorName?: string;
      /** Pointer to the StructureRepresentation of the protoype if one exists. */
      prototypeStructure?: StructureDescription;
      /** If true, it indicates that the fields in this StructureDescription may be inaccurate. I.e, there might have been fields that have been deleted before it was profiled or it has fields we haven't profiled. */
      isImprecise?: boolean;
    };
    export type TypeSet = {
      /** Indicates if this type description has been type Function. */
      isFunction: boolean;
      /** Indicates if this type description has been type Undefined. */
      isUndefined: boolean;
      /** Indicates if this type description has been type Null. */
      isNull: boolean;
      /** Indicates if this type description has been type Boolean. */
      isBoolean: boolean;
      /** Indicates if this type description has been type Integer. */
      isInteger: boolean;
      /** Indicates if this type description has been type Number. */
      isNumber: boolean;
      /** Indicates if this type description has been type String. */
      isString: boolean;
      /** Indicates if this type description has been type Object. */
      isObject: boolean;
      /** Indicates if this type description has been type Symbol. */
      isSymbol: boolean;
      /** Indicates if this type description has been type BigInt. */
      isBigInt: boolean;
    };
    /** Container for type information that has been gathered. */
    export type TypeDescription = {
      /** If true, we were able to correlate the offset successfuly with a program location. If false, the offset may be bogus or the offset may be from a CodeBlock that hasn't executed. */
      isValid: boolean;
      /** Least common ancestor of all Constructors if the TypeDescription has seen any structures. This string is the display name of the shared constructor function. */
      leastCommonAncestor?: string;
      /** Set of booleans for determining the aggregate type of this type description. */
      typeSet?: TypeSet;
      /** Array of descriptions for all structures seen for this variable. */
      structures?: Array<StructureDescription>;
      /** If true, this indicates that no more structures are being profiled because some maximum threshold has been reached and profiling has stopped because of memory pressure. */
      isTruncated?: boolean;
    };
    /** Describes the location of an expression we want type information for. */
    export type TypeLocation = {
      /** What kind of type information do we want (normal, function return values, 'this' statement). */
      typeInformationDescriptor: number;
      /** sourceID uniquely identifying a script */
      sourceID: string;
      /** character offset for assignment range */
      divot: number;
    };
    /** From Wikipedia: a basic block is a portion of the code within a program with only one entry point and only one exit point. This type gives the location of a basic block and if that basic block has executed. */
    export type BasicBlock = {
      /** Start offset of the basic block. */
      startOffset: number;
      /** End offset of the basic block. */
      endOffset: number;
      /** Indicates if the basic block has executed before. */
      hasExecuted: boolean;
      /** Indicates how many times the basic block has executed. */
      executionCount: number;
    };
    /** `Runtime.executionContextCreated` */
    export type ExecutionContextCreatedEvent = {
      /** A newly created execution context. */
      context: ExecutionContextDescription;
    };
    /** `Runtime.parse` */
    export type ParseRequest = {
      /** Source code to parse. */
      source: string;
    };
    /** `Runtime.parse` */
    export type ParseResponse = {
      /** Parse result. */
      result: SyntaxErrorType;
      /** Parse error message. */
      message?: string;
      /** Range in the source where the error occurred. */
      range?: ErrorRange;
    };
    /** `Runtime.evaluate` */
    export type EvaluateRequest = {
      /** Expression to evaluate. */
      expression: string;
      /** Symbolic group name that can be used to release multiple objects. */
      objectGroup?: string;
      /** Determines whether Command Line API should be available during the evaluation. */
      includeCommandLineAPI?: boolean;
      /** Specifies whether evaluation should stop on exceptions and mute console. Overrides setPauseOnException state. */
      doNotPauseOnExceptionsAndMuteConsole?: boolean;
      /** Specifies in which isolated context to perform evaluation. Each content script lives in an isolated context and this parameter may be used to specify one of those contexts. If the parameter is omitted or 0 the evaluation will be performed in the context of the inspected page. */
      contextId?: Runtime.ExecutionContextId;
      /** Whether the result is expected to be a JSON object that should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
      /** Whether the resulting value should be considered for saving in the $n history. */
      saveResult?: boolean;
      /** Whether the expression should be considered to be in a user gesture or not. */
      emulateUserGesture?: boolean;
    };
    /** `Runtime.evaluate` */
    export type EvaluateResponse = {
      /** Evaluation result. */
      result: RemoteObject;
      /** True if the result was thrown during the evaluation. */
      wasThrown?: boolean;
      /** If the result was saved, this is the $n index that can be used to access the value. */
      savedResultIndex?: number;
    };
    /** `Runtime.awaitPromise` */
    export type AwaitPromiseRequest = {
      /** Identifier of the promise. */
      promiseObjectId: RemoteObjectId;
      /** Whether the result is expected to be a JSON object that should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
      /** Whether the resulting value should be considered for saving in the $n history. */
      saveResult?: boolean;
    };
    /** `Runtime.awaitPromise` */
    export type AwaitPromiseResponse = {
      /** Evaluation result. */
      result: RemoteObject;
      /** True if the result was thrown during the evaluation. */
      wasThrown?: boolean;
      /** If the result was saved, this is the $n index that can be used to access the value. */
      savedResultIndex?: number;
    };
    /** `Runtime.callFunctionOn` */
    export type CallFunctionOnRequest = {
      /** Identifier of the object to call function on. */
      objectId: RemoteObjectId;
      /** Declaration of the function to call. */
      functionDeclaration: string;
      /** Call arguments. All call arguments must belong to the same JavaScript world as the target object. */
      arguments?: Array<CallArgument>;
      /** Specifies whether function call should stop on exceptions and mute console. Overrides setPauseOnException state. */
      doNotPauseOnExceptionsAndMuteConsole?: boolean;
      /** Whether the result is expected to be a JSON object which should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
      /** Whether the expression should be considered to be in a user gesture or not. */
      emulateUserGesture?: boolean;
    };
    /** `Runtime.callFunctionOn` */
    export type CallFunctionOnResponse = {
      /** Call result. */
      result: RemoteObject;
      /** True if the result was thrown during the evaluation. */
      wasThrown?: boolean;
    };
    /** `Runtime.getPreview` */
    export type GetPreviewRequest = {
      /** Identifier of the object to return a preview for. */
      objectId: RemoteObjectId;
    };
    /** `Runtime.getPreview` */
    export type GetPreviewResponse = {
      preview: ObjectPreview;
    };
    /** `Runtime.getProperties` */
    export type GetPropertiesRequest = {
      /** Identifier of the object to return properties for. */
      objectId: RemoteObjectId;
      /** If true, returns properties belonging only to the object itself, not to its prototype chain. */
      ownProperties?: boolean;
      /** If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId` is for a `iterator`/`WeakMap`/`WeakSet` object. */
      fetchStart?: number;
      /** If provided only return `fetchCount` values. Otherwise, return values all the way to the end. */
      fetchCount?: number;
      /** Whether preview should be generated for property values. */
      generatePreview?: boolean;
    };
    /** `Runtime.getProperties` */
    export type GetPropertiesResponse = {
      /** Object properties. */
      properties: Array<PropertyDescriptor>;
      /** Internal object properties. Only included if `fetchStart` is 0. */
      internalProperties?: Array<InternalPropertyDescriptor>;
    };
    /** `Runtime.getDisplayableProperties` */
    export type GetDisplayablePropertiesRequest = {
      /** Identifier of the object to return properties for. */
      objectId: RemoteObjectId;
      /** If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId` is for a `iterator`/`WeakMap`/`WeakSet` object. */
      fetchStart?: number;
      /** If provided only return `fetchCount` values. Otherwise, return values all the way to the end. */
      fetchCount?: number;
      /** Whether preview should be generated for property values. */
      generatePreview?: boolean;
    };
    /** `Runtime.getDisplayableProperties` */
    export type GetDisplayablePropertiesResponse = {
      /** Object properties. */
      properties: Array<PropertyDescriptor>;
      /** Internal object properties. Only included if `fetchStart` is 0. */
      internalProperties?: Array<InternalPropertyDescriptor>;
    };
    /** `Runtime.getCollectionEntries` */
    export type GetCollectionEntriesRequest = {
      /** Id of the collection to get entries for. */
      objectId: Runtime.RemoteObjectId;
      /** Symbolic group name that can be used to release multiple. If not provided, it will be the same objectGroup as the RemoteObject determined from <code>objectId</code>. This is useful for WeakMap to release the collection entries. */
      objectGroup?: string;
      /** If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId<` is for a `iterator<`/`WeakMap<`/`WeakSet<` object. */
      fetchStart?: number;
      /** If provided only return `fetchCount` values. Otherwise, return values all the way to the end. */
      fetchCount?: number;
    };
    /** `Runtime.getCollectionEntries` */
    export type GetCollectionEntriesResponse = {
      /** Array of collection entries. */
      entries: Array<CollectionEntry>;
    };
    /** `Runtime.saveResult` */
    export type SaveResultRequest = {
      /** Id or value of the object to save. */
      value: CallArgument;
      /** Unique id of the execution context. To specify in which execution context script evaluation should be performed. If not provided, determine from the CallArgument's objectId. */
      contextId?: ExecutionContextId;
    };
    /** `Runtime.saveResult` */
    export type SaveResultResponse = {
      /** If the value was saved, this is the $n index that can be used to access the value. */
      savedResultIndex?: number;
    };
    /** `Runtime.setSavedResultAlias` */
    export type SetSavedResultAliasRequest = {
      /** Passing an empty/null string will clear the alias. */
      alias?: string;
    };
    /** `Runtime.setSavedResultAlias` */
    export type SetSavedResultAliasResponse = {};
    /** `Runtime.releaseObject` */
    export type ReleaseObjectRequest = {
      /** Identifier of the object to release. */
      objectId: RemoteObjectId;
    };
    /** `Runtime.releaseObject` */
    export type ReleaseObjectResponse = {};
    /** `Runtime.releaseObjectGroup` */
    export type ReleaseObjectGroupRequest = {
      /** Symbolic object group name. */
      objectGroup: string;
    };
    /** `Runtime.releaseObjectGroup` */
    export type ReleaseObjectGroupResponse = {};
    /** `Runtime.enable` */
    export type EnableRequest = {};
    /** `Runtime.enable` */
    export type EnableResponse = {};
    /** `Runtime.disable` */
    export type DisableRequest = {};
    /** `Runtime.disable` */
    export type DisableResponse = {};
    /** `Runtime.getRuntimeTypesForVariablesAtOffsets` */
    export type GetRuntimeTypesForVariablesAtOffsetsRequest = {
      /** An array of type locations we're requesting information for. Results are expected in the same order they're sent in. */
      locations: Array<TypeLocation>;
    };
    /** `Runtime.getRuntimeTypesForVariablesAtOffsets` */
    export type GetRuntimeTypesForVariablesAtOffsetsResponse = {
      types: Array<TypeDescription>;
    };
    /** `Runtime.enableTypeProfiler` */
    export type EnableTypeProfilerRequest = {};
    /** `Runtime.enableTypeProfiler` */
    export type EnableTypeProfilerResponse = {};
    /** `Runtime.disableTypeProfiler` */
    export type DisableTypeProfilerRequest = {};
    /** `Runtime.disableTypeProfiler` */
    export type DisableTypeProfilerResponse = {};
    /** `Runtime.enableControlFlowProfiler` */
    export type EnableControlFlowProfilerRequest = {};
    /** `Runtime.enableControlFlowProfiler` */
    export type EnableControlFlowProfilerResponse = {};
    /** `Runtime.disableControlFlowProfiler` */
    export type DisableControlFlowProfilerRequest = {};
    /** `Runtime.disableControlFlowProfiler` */
    export type DisableControlFlowProfilerResponse = {};
    /** `Runtime.getBasicBlocks` */
    export type GetBasicBlocksRequest = {
      /** Indicates which sourceID information is requested for. */
      sourceID: string;
    };
    /** `Runtime.getBasicBlocks` */
    export type GetBasicBlocksResponse = {
      basicBlocks: Array<BasicBlock>;
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
      /** 1-based. */
      line: number;
      /** 1-based. */
      column: number;
    };
    export type StackFrame = {
      /** Unique script identifier. */
      sourceID: Debugger.ScriptId;
      /** A displayable name for the stack frame. i.e function name, (program), etc. */
      name: string;
      /** -1 if unavailable. 1-based if available. */
      line: number;
      /** -1 if unavailable. 1-based if available. */
      column: number;
      url: string;
      expressionLocation?: ExpressionLocation;
    };
    export type StackTrace = {
      timestamp: number;
      /** First array item is the bottom of the call stack and last array item is the top of the call stack. */
      stackFrames: Array<StackFrame>;
    };
    export type Samples = {
      stackTraces: Array<StackTrace>;
    };
    /** `ScriptProfiler.trackingStart` */
    export type TrackingStartEvent = {
      timestamp: number;
    };
    /** `ScriptProfiler.trackingUpdate` */
    export type TrackingUpdateEvent = {
      event: Event;
    };
    /** `ScriptProfiler.trackingComplete` */
    export type TrackingCompleteEvent = {
      timestamp: number;
      /** Stack traces. */
      samples?: Samples;
    };
    /** `ScriptProfiler.startTracking` */
    export type StartTrackingRequest = {
      /** Start the sampling profiler, defaults to false. */
      includeSamples?: boolean;
    };
    /** `ScriptProfiler.startTracking` */
    export type StartTrackingResponse = {};
    /** `ScriptProfiler.stopTracking` */
    export type StopTrackingRequest = {};
    /** `ScriptProfiler.stopTracking` */
    export type StopTrackingResponse = {};
  }
  export type EventMap = {
    "Console.messageAdded": Console.MessageAddedEvent;
    "Console.messageRepeatCountUpdated": Console.MessageRepeatCountUpdatedEvent;
    "Console.messagesCleared": Console.MessagesClearedEvent;
    "Console.heapSnapshot": Console.HeapSnapshotEvent;
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
  export type Event<T extends keyof EventMap> = {
    method: T;
    params: EventMap[T];
  };
  export type Request<T extends keyof RequestMap> = {
    id: number;
    method: T;
    params: RequestMap[T];
  };
  export type Response<T extends keyof ResponseMap> = {
    id: number;
  } & (
    | {
        method?: T;
        result: ResponseMap[T];
      }
    | {
        error: {
          code?: string;
          message: string;
        };
      }
  );
}
