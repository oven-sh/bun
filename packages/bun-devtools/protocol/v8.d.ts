// GENERATED - DO NOT EDIT
export namespace V8 {
  export namespace Console {
    /** Console message. */
    export type ConsoleMessage = {
      /** Message source. */
      source:
        | "xml"
        | "javascript"
        | "network"
        | "console-api"
        | "storage"
        | "appcache"
        | "rendering"
        | "security"
        | "other"
        | "deprecation"
        | "worker";
      /** Message severity. */
      level: "log" | "warning" | "error" | "debug" | "info";
      /** Message text. */
      text: string;
      /** URL of the message origin. */
      url?: string;
      /** Line number in the resource that generated this message (1-based). */
      line?: number;
      /** Column number in the resource that generated this message (1-based). */
      column?: number;
    };
    /** `Console.messageAdded` */
    export type MessageAddedEvent = {
      /** Console message that has been added. */
      message: ConsoleMessage;
    };
    /** `Console.clearMessages` */
    export type ClearMessagesRequest = {};
    /** `Console.clearMessages` */
    export type ClearMessagesResponse = {};
    /** `Console.disable` */
    export type DisableRequest = {};
    /** `Console.disable` */
    export type DisableResponse = {};
    /** `Console.enable` */
    export type EnableRequest = {};
    /** `Console.enable` */
    export type EnableResponse = {};
  }
  export namespace Debugger {
    /** Breakpoint identifier. */
    export type BreakpointId = string;
    /** Call frame identifier. */
    export type CallFrameId = string;
    /** Location in the source code. */
    export type Location = {
      /** Script identifier as reported in the `Debugger.scriptParsed`. */
      scriptId: Runtime.ScriptId;
      /** Line number in the script (0-based). */
      lineNumber: number;
      /** Column number in the script (0-based). */
      columnNumber?: number;
    };
    /** Location in the source code. */
    export type ScriptPosition = {
      lineNumber: number;
      columnNumber: number;
    };
    /** Location range within one script. */
    export type LocationRange = {
      scriptId: Runtime.ScriptId;
      start: ScriptPosition;
      end: ScriptPosition;
    };
    /** JavaScript call frame. Array of call frames form the call stack. */
    export type CallFrame = {
      /** Call frame identifier. This identifier is only valid while the virtual machine is paused. */
      callFrameId: CallFrameId;
      /** Name of the JavaScript function called on this call frame. */
      functionName: string;
      /** Location in the source code. */
      functionLocation?: Location;
      /** Location in the source code. */
      location: Location;
      /** JavaScript script name or url.
Deprecated in favor of using the `location.scriptId` to resolve the URL via a previously
sent `Debugger.scriptParsed` event. */
      url: string;
      /** Scope chain for this call frame. */
      scopeChain: Array<Scope>;
      /** `this` object for this call frame. */
      this: Runtime.RemoteObject;
      /** The value being returned, if the function is at return point. */
      returnValue?: Runtime.RemoteObject;
      /** Valid only while the VM is paused and indicates whether this frame
can be restarted or not. Note that a `true` value here does not
guarantee that Debugger#restartFrame with this CallFrameId will be
successful, but it is very likely. */
      canBeRestarted?: boolean;
    };
    /** Scope description. */
    export type Scope = {
      /** Scope type. */
      type:
        | "global"
        | "local"
        | "with"
        | "closure"
        | "catch"
        | "block"
        | "script"
        | "eval"
        | "module"
        | "wasm-expression-stack";
      /** Object representing the scope. For `global` and `with` scopes it represents the actual
object; for the rest of the scopes, it is artificial transient object enumerating scope
variables as its properties. */
      object: Runtime.RemoteObject;
      name?: string;
      /** Location in the source code where scope starts */
      startLocation?: Location;
      /** Location in the source code where scope ends */
      endLocation?: Location;
    };
    /** Search match for resource. */
    export type SearchMatch = {
      /** Line number in resource content. */
      lineNumber: number;
      /** Line with match content. */
      lineContent: string;
    };
    export type BreakLocation = {
      /** Script identifier as reported in the `Debugger.scriptParsed`. */
      scriptId: Runtime.ScriptId;
      /** Line number in the script (0-based). */
      lineNumber: number;
      /** Column number in the script (0-based). */
      columnNumber?: number;
      type?: "debuggerStatement" | "call" | "return";
    };
    export type WasmDisassemblyChunk = {
      /** The next chunk of disassembled lines. */
      lines: Array<string>;
      /** The bytecode offsets describing the start of each line. */
      bytecodeOffsets: Array<number>;
    };
    /** Enum of possible script languages. */
    export type ScriptLanguage = "JavaScript" | "WebAssembly";
    /** Debug symbols available for a wasm script. */
    export type DebugSymbols = {
      /** Type of the debug symbols. */
      type: "None" | "SourceMap" | "EmbeddedDWARF" | "ExternalDWARF";
      /** URL of the external symbol source. */
      externalURL?: string;
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
        | "ambiguous"
        | "assert"
        | "CSPViolation"
        | "debugCommand"
        | "DOM"
        | "EventListener"
        | "exception"
        | "instrumentation"
        | "OOM"
        | "other"
        | "promiseRejection"
        | "XHR"
        | "step";
      /** Object containing break-specific auxiliary properties. */
      data?: Record<string, unknown>;
      /** Hit breakpoints IDs */
      hitBreakpoints?: Array<string>;
      /** Async stack trace, if any. */
      asyncStackTrace?: Runtime.StackTrace;
      /** Async stack trace, if any. */
      asyncStackTraceId?: Runtime.StackTraceId;
      /** Never present, will be removed. */
      asyncCallStackTraceId?: Runtime.StackTraceId;
    };
    /** `Debugger.resumed` */
    export type ResumedEvent = {};
    /** `Debugger.scriptFailedToParse` */
    export type ScriptFailedToParseEvent = {
      /** Identifier of the script parsed. */
      scriptId: Runtime.ScriptId;
      /** URL or name of the script parsed (if any). */
      url: string;
      /** Line offset of the script within the resource with given URL (for script tags). */
      startLine: number;
      /** Column offset of the script within the resource with given URL. */
      startColumn: number;
      /** Last line of the script. */
      endLine: number;
      /** Length of the last line of the script. */
      endColumn: number;
      /** Specifies script creation context. */
      executionContextId: Runtime.ExecutionContextId;
      /** Content hash of the script, SHA-256. */
      hash: string;
      /** Embedder-specific auxiliary data. */
      executionContextAuxData?: Record<string, unknown>;
      /** URL of source map associated with script (if any). */
      sourceMapURL?: string;
      /** True, if this script has sourceURL. */
      hasSourceURL?: boolean;
      /** True, if this script is ES6 module. */
      isModule?: boolean;
      /** This script length. */
      length?: number;
      /** JavaScript top stack frame of where the script parsed event was triggered if available. */
      stackTrace?: Runtime.StackTrace;
      /** If the scriptLanguage is WebAssembly, the code section offset in the module. */
      codeOffset?: number;
      /** The language of the script. */
      scriptLanguage?: Debugger.ScriptLanguage;
      /** The name the embedder supplied for this script. */
      embedderName?: string;
    };
    /** `Debugger.scriptParsed` */
    export type ScriptParsedEvent = {
      /** Identifier of the script parsed. */
      scriptId: Runtime.ScriptId;
      /** URL or name of the script parsed (if any). */
      url: string;
      /** Line offset of the script within the resource with given URL (for script tags). */
      startLine: number;
      /** Column offset of the script within the resource with given URL. */
      startColumn: number;
      /** Last line of the script. */
      endLine: number;
      /** Length of the last line of the script. */
      endColumn: number;
      /** Specifies script creation context. */
      executionContextId: Runtime.ExecutionContextId;
      /** Content hash of the script, SHA-256. */
      hash: string;
      /** Embedder-specific auxiliary data. */
      executionContextAuxData?: Record<string, unknown>;
      /** True, if this script is generated as a result of the live edit operation. */
      isLiveEdit?: boolean;
      /** URL of source map associated with script (if any). */
      sourceMapURL?: string;
      /** True, if this script has sourceURL. */
      hasSourceURL?: boolean;
      /** True, if this script is ES6 module. */
      isModule?: boolean;
      /** This script length. */
      length?: number;
      /** JavaScript top stack frame of where the script parsed event was triggered if available. */
      stackTrace?: Runtime.StackTrace;
      /** If the scriptLanguage is WebAssembly, the code section offset in the module. */
      codeOffset?: number;
      /** The language of the script. */
      scriptLanguage?: Debugger.ScriptLanguage;
      /** If the scriptLanguage is WebASsembly, the source of debug symbols for the module. */
      debugSymbols?: Debugger.DebugSymbols;
      /** The name the embedder supplied for this script. */
      embedderName?: string;
    };
    /** `Debugger.continueToLocation` */
    export type ContinueToLocationRequest = {
      /** Location to continue to. */
      location: Location;
      targetCallFrames?: "any" | "current";
    };
    /** `Debugger.continueToLocation` */
    export type ContinueToLocationResponse = {};
    /** `Debugger.disable` */
    export type DisableRequest = {};
    /** `Debugger.disable` */
    export type DisableResponse = {};
    /** `Debugger.enable` */
    export type EnableRequest = {
      /** The maximum size in bytes of collected scripts (not referenced by other heap objects)
the debugger can hold. Puts no limit if parameter is omitted. */
      maxScriptsCacheSize?: number;
    };
    /** `Debugger.enable` */
    export type EnableResponse = {
      /** Unique identifier of the debugger. */
      debuggerId: Runtime.UniqueDebuggerId;
    };
    /** `Debugger.evaluateOnCallFrame` */
    export type EvaluateOnCallFrameRequest = {
      /** Call frame identifier to evaluate on. */
      callFrameId: CallFrameId;
      /** Expression to evaluate. */
      expression: string;
      /** String object group name to put result into (allows rapid releasing resulting object handles
using `releaseObjectGroup`). */
      objectGroup?: string;
      /** Specifies whether command line API should be available to the evaluated expression, defaults
to false. */
      includeCommandLineAPI?: boolean;
      /** In silent mode exceptions thrown during evaluation are not reported and do not pause
execution. Overrides `setPauseOnException` state. */
      silent?: boolean;
      /** Whether the result is expected to be a JSON object that should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
      /** Whether to throw an exception if side effect cannot be ruled out during evaluation. */
      throwOnSideEffect?: boolean;
      /** Terminate execution after timing out (number of milliseconds). */
      timeout?: Runtime.TimeDelta;
    };
    /** `Debugger.evaluateOnCallFrame` */
    export type EvaluateOnCallFrameResponse = {
      /** Object wrapper for the evaluation result. */
      result: Runtime.RemoteObject;
      /** Exception details. */
      exceptionDetails?: Runtime.ExceptionDetails;
    };
    /** `Debugger.getPossibleBreakpoints` */
    export type GetPossibleBreakpointsRequest = {
      /** Start of range to search possible breakpoint locations in. */
      start: Location;
      /** End of range to search possible breakpoint locations in (excluding). When not specified, end
of scripts is used as end of range. */
      end?: Location;
      /** Only consider locations which are in the same (non-nested) function as start. */
      restrictToFunction?: boolean;
    };
    /** `Debugger.getPossibleBreakpoints` */
    export type GetPossibleBreakpointsResponse = {
      /** List of the possible breakpoint locations. */
      locations: Array<BreakLocation>;
    };
    /** `Debugger.getScriptSource` */
    export type GetScriptSourceRequest = {
      /** Id of the script to get source for. */
      scriptId: Runtime.ScriptId;
    };
    /** `Debugger.getScriptSource` */
    export type GetScriptSourceResponse = {
      /** Script source (empty in case of Wasm bytecode). */
      scriptSource: string;
      /** Wasm bytecode. (Encoded as a base64 string when passed over JSON) */
      bytecode?: string;
    };
    /** `Debugger.disassembleWasmModule` */
    export type DisassembleWasmModuleRequest = {
      /** Id of the script to disassemble */
      scriptId: Runtime.ScriptId;
    };
    /** `Debugger.disassembleWasmModule` */
    export type DisassembleWasmModuleResponse = {
      /** For large modules, return a stream from which additional chunks of
disassembly can be read successively. */
      streamId?: string;
      /** The total number of lines in the disassembly text. */
      totalNumberOfLines: number;
      /** The offsets of all function bodies, in the format [start1, end1,
start2, end2, ...] where all ends are exclusive. */
      functionBodyOffsets: Array<number>;
      /** The first chunk of disassembly. */
      chunk: WasmDisassemblyChunk;
    };
    /** `Debugger.nextWasmDisassemblyChunk` */
    export type NextWasmDisassemblyChunkRequest = {
      streamId: string;
    };
    /** `Debugger.nextWasmDisassemblyChunk` */
    export type NextWasmDisassemblyChunkResponse = {
      /** The next chunk of disassembly. */
      chunk: WasmDisassemblyChunk;
    };
    /** `Debugger.getWasmBytecode` */
    export type GetWasmBytecodeRequest = {
      /** Id of the Wasm script to get source for. */
      scriptId: Runtime.ScriptId;
    };
    /** `Debugger.getWasmBytecode` */
    export type GetWasmBytecodeResponse = {
      /** Script source. (Encoded as a base64 string when passed over JSON) */
      bytecode: string;
    };
    /** `Debugger.getStackTrace` */
    export type GetStackTraceRequest = {
      stackTraceId: Runtime.StackTraceId;
    };
    /** `Debugger.getStackTrace` */
    export type GetStackTraceResponse = {
      stackTrace: Runtime.StackTrace;
    };
    /** `Debugger.pause` */
    export type PauseRequest = {};
    /** `Debugger.pause` */
    export type PauseResponse = {};
    /** `Debugger.pauseOnAsyncCall` */
    export type PauseOnAsyncCallRequest = {
      /** Debugger will pause when async call with given stack trace is started. */
      parentStackTraceId: Runtime.StackTraceId;
    };
    /** `Debugger.pauseOnAsyncCall` */
    export type PauseOnAsyncCallResponse = {};
    /** `Debugger.removeBreakpoint` */
    export type RemoveBreakpointRequest = {
      breakpointId: BreakpointId;
    };
    /** `Debugger.removeBreakpoint` */
    export type RemoveBreakpointResponse = {};
    /** `Debugger.restartFrame` */
    export type RestartFrameRequest = {
      /** Call frame identifier to evaluate on. */
      callFrameId: CallFrameId;
      /** The `mode` parameter must be present and set to 'StepInto', otherwise
`restartFrame` will error out. */
      mode?: "StepInto";
    };
    /** `Debugger.restartFrame` */
    export type RestartFrameResponse = {
      /** New stack trace. */
      callFrames: Array<CallFrame>;
      /** Async stack trace, if any. */
      asyncStackTrace?: Runtime.StackTrace;
      /** Async stack trace, if any. */
      asyncStackTraceId?: Runtime.StackTraceId;
    };
    /** `Debugger.resume` */
    export type ResumeRequest = {
      /** Set to true to terminate execution upon resuming execution. In contrast
to Runtime.terminateExecution, this will allows to execute further
JavaScript (i.e. via evaluation) until execution of the paused code
is actually resumed, at which point termination is triggered.
If execution is currently not paused, this parameter has no effect. */
      terminateOnResume?: boolean;
    };
    /** `Debugger.resume` */
    export type ResumeResponse = {};
    /** `Debugger.searchInContent` */
    export type SearchInContentRequest = {
      /** Id of the script to search in. */
      scriptId: Runtime.ScriptId;
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
      result: Array<SearchMatch>;
    };
    /** `Debugger.setAsyncCallStackDepth` */
    export type SetAsyncCallStackDepthRequest = {
      /** Maximum depth of async call stacks. Setting to `0` will effectively disable collecting async
call stacks (default). */
      maxDepth: number;
    };
    /** `Debugger.setAsyncCallStackDepth` */
    export type SetAsyncCallStackDepthResponse = {};
    /** `Debugger.setBlackboxPatterns` */
    export type SetBlackboxPatternsRequest = {
      /** Array of regexps that will be used to check script url for blackbox state. */
      patterns: Array<string>;
    };
    /** `Debugger.setBlackboxPatterns` */
    export type SetBlackboxPatternsResponse = {};
    /** `Debugger.setBlackboxedRanges` */
    export type SetBlackboxedRangesRequest = {
      /** Id of the script. */
      scriptId: Runtime.ScriptId;
      positions: Array<ScriptPosition>;
    };
    /** `Debugger.setBlackboxedRanges` */
    export type SetBlackboxedRangesResponse = {};
    /** `Debugger.setBreakpoint` */
    export type SetBreakpointRequest = {
      /** Location to set breakpoint in. */
      location: Location;
      /** Expression to use as a breakpoint condition. When specified, debugger will only stop on the
breakpoint if this expression evaluates to true. */
      condition?: string;
    };
    /** `Debugger.setBreakpoint` */
    export type SetBreakpointResponse = {
      /** Id of the created breakpoint for further reference. */
      breakpointId: BreakpointId;
      /** Location this breakpoint resolved into. */
      actualLocation: Location;
    };
    /** `Debugger.setInstrumentationBreakpoint` */
    export type SetInstrumentationBreakpointRequest = {
      /** Instrumentation name. */
      instrumentation: "beforeScriptExecution" | "beforeScriptWithSourceMapExecution";
    };
    /** `Debugger.setInstrumentationBreakpoint` */
    export type SetInstrumentationBreakpointResponse = {
      /** Id of the created breakpoint for further reference. */
      breakpointId: BreakpointId;
    };
    /** `Debugger.setBreakpointByUrl` */
    export type SetBreakpointByUrlRequest = {
      /** Line number to set breakpoint at. */
      lineNumber: number;
      /** URL of the resources to set breakpoint on. */
      url?: string;
      /** Regex pattern for the URLs of the resources to set breakpoints on. Either `url` or
`urlRegex` must be specified. */
      urlRegex?: string;
      /** Script hash of the resources to set breakpoint on. */
      scriptHash?: string;
      /** Offset in the line to set breakpoint at. */
      columnNumber?: number;
      /** Expression to use as a breakpoint condition. When specified, debugger will only stop on the
breakpoint if this expression evaluates to true. */
      condition?: string;
    };
    /** `Debugger.setBreakpointByUrl` */
    export type SetBreakpointByUrlResponse = {
      /** Id of the created breakpoint for further reference. */
      breakpointId: BreakpointId;
      /** List of the locations this breakpoint resolved into upon addition. */
      locations: Array<Location>;
    };
    /** `Debugger.setBreakpointOnFunctionCall` */
    export type SetBreakpointOnFunctionCallRequest = {
      /** Function object id. */
      objectId: Runtime.RemoteObjectId;
      /** Expression to use as a breakpoint condition. When specified, debugger will
stop on the breakpoint if this expression evaluates to true. */
      condition?: string;
    };
    /** `Debugger.setBreakpointOnFunctionCall` */
    export type SetBreakpointOnFunctionCallResponse = {
      /** Id of the created breakpoint for further reference. */
      breakpointId: BreakpointId;
    };
    /** `Debugger.setBreakpointsActive` */
    export type SetBreakpointsActiveRequest = {
      /** New value for breakpoints active state. */
      active: boolean;
    };
    /** `Debugger.setBreakpointsActive` */
    export type SetBreakpointsActiveResponse = {};
    /** `Debugger.setPauseOnExceptions` */
    export type SetPauseOnExceptionsRequest = {
      /** Pause on exceptions mode. */
      state: "none" | "caught" | "uncaught" | "all";
    };
    /** `Debugger.setPauseOnExceptions` */
    export type SetPauseOnExceptionsResponse = {};
    /** `Debugger.setReturnValue` */
    export type SetReturnValueRequest = {
      /** New return value. */
      newValue: Runtime.CallArgument;
    };
    /** `Debugger.setReturnValue` */
    export type SetReturnValueResponse = {};
    /** `Debugger.setScriptSource` */
    export type SetScriptSourceRequest = {
      /** Id of the script to edit. */
      scriptId: Runtime.ScriptId;
      /** New content of the script. */
      scriptSource: string;
      /** If true the change will not actually be applied. Dry run may be used to get result
description without actually modifying the code. */
      dryRun?: boolean;
      /** If true, then `scriptSource` is allowed to change the function on top of the stack
as long as the top-most stack frame is the only activation of that function. */
      allowTopFrameEditing?: boolean;
    };
    /** `Debugger.setScriptSource` */
    export type SetScriptSourceResponse = {
      /** New stack trace in case editing has happened while VM was stopped. */
      callFrames?: Array<CallFrame>;
      /** Whether current call stack  was modified after applying the changes. */
      stackChanged?: boolean;
      /** Async stack trace, if any. */
      asyncStackTrace?: Runtime.StackTrace;
      /** Async stack trace, if any. */
      asyncStackTraceId?: Runtime.StackTraceId;
      /** Whether the operation was successful or not. Only `Ok` denotes a
successful live edit while the other enum variants denote why
the live edit failed. */
      status:
        | "Ok"
        | "CompileError"
        | "BlockedByActiveGenerator"
        | "BlockedByActiveFunction"
        | "BlockedByTopLevelEsModuleChange";
      /** Exception details if any. Only present when `status` is `CompileError`. */
      exceptionDetails?: Runtime.ExceptionDetails;
    };
    /** `Debugger.setSkipAllPauses` */
    export type SetSkipAllPausesRequest = {
      /** New value for skip pauses state. */
      skip: boolean;
    };
    /** `Debugger.setSkipAllPauses` */
    export type SetSkipAllPausesResponse = {};
    /** `Debugger.setVariableValue` */
    export type SetVariableValueRequest = {
      /** 0-based number of scope as was listed in scope chain. Only 'local', 'closure' and 'catch'
scope types are allowed. Other scopes could be manipulated manually. */
      scopeNumber: number;
      /** Variable name. */
      variableName: string;
      /** New variable value. */
      newValue: Runtime.CallArgument;
      /** Id of callframe that holds variable. */
      callFrameId: CallFrameId;
    };
    /** `Debugger.setVariableValue` */
    export type SetVariableValueResponse = {};
    /** `Debugger.stepInto` */
    export type StepIntoRequest = {
      /** Debugger will pause on the execution of the first async task which was scheduled
before next pause. */
      breakOnAsyncCall?: boolean;
      /** The skipList specifies location ranges that should be skipped on step into. */
      skipList?: Array<LocationRange>;
    };
    /** `Debugger.stepInto` */
    export type StepIntoResponse = {};
    /** `Debugger.stepOut` */
    export type StepOutRequest = {};
    /** `Debugger.stepOut` */
    export type StepOutResponse = {};
    /** `Debugger.stepOver` */
    export type StepOverRequest = {
      /** The skipList specifies location ranges that should be skipped on step over. */
      skipList?: Array<LocationRange>;
    };
    /** `Debugger.stepOver` */
    export type StepOverResponse = {};
  }
  export namespace HeapProfiler {
    /** Heap snapshot object id. */
    export type HeapSnapshotObjectId = string;
    /** Sampling Heap Profile node. Holds callsite information, allocation statistics and child nodes. */
    export type SamplingHeapProfileNode = {
      /** Function location. */
      callFrame: Runtime.CallFrame;
      /** Allocations size in bytes for the node excluding children. */
      selfSize: number;
      /** Node id. Ids are unique across all profiles collected between startSampling and stopSampling. */
      id: number;
      /** Child nodes. */
      children: Array<SamplingHeapProfileNode>;
    };
    /** A single sample from a sampling profile. */
    export type SamplingHeapProfileSample = {
      /** Allocation size in bytes attributed to the sample. */
      size: number;
      /** Id of the corresponding profile tree node. */
      nodeId: number;
      /** Time-ordered sample ordinal number. It is unique across all profiles retrieved
between startSampling and stopSampling. */
      ordinal: number;
    };
    /** Sampling profile. */
    export type SamplingHeapProfile = {
      head: SamplingHeapProfileNode;
      samples: Array<SamplingHeapProfileSample>;
    };
    /** `HeapProfiler.addHeapSnapshotChunk` */
    export type AddHeapSnapshotChunkEvent = {
      chunk: string;
    };
    /** `HeapProfiler.heapStatsUpdate` */
    export type HeapStatsUpdateEvent = {
      /** An array of triplets. Each triplet describes a fragment. The first integer is the fragment
index, the second integer is a total count of objects for the fragment, the third integer is
a total size of the objects for the fragment. */
      statsUpdate: Array<number>;
    };
    /** `HeapProfiler.lastSeenObjectId` */
    export type LastSeenObjectIdEvent = {
      lastSeenObjectId: number;
      timestamp: number;
    };
    /** `HeapProfiler.reportHeapSnapshotProgress` */
    export type ReportHeapSnapshotProgressEvent = {
      done: number;
      total: number;
      finished?: boolean;
    };
    /** `HeapProfiler.resetProfiles` */
    export type ResetProfilesEvent = {};
    /** `HeapProfiler.addInspectedHeapObject` */
    export type AddInspectedHeapObjectRequest = {
      /** Heap snapshot object id to be accessible by means of $x command line API. */
      heapObjectId: HeapSnapshotObjectId;
    };
    /** `HeapProfiler.addInspectedHeapObject` */
    export type AddInspectedHeapObjectResponse = {};
    /** `HeapProfiler.collectGarbage` */
    export type CollectGarbageRequest = {};
    /** `HeapProfiler.collectGarbage` */
    export type CollectGarbageResponse = {};
    /** `HeapProfiler.disable` */
    export type DisableRequest = {};
    /** `HeapProfiler.disable` */
    export type DisableResponse = {};
    /** `HeapProfiler.enable` */
    export type EnableRequest = {};
    /** `HeapProfiler.enable` */
    export type EnableResponse = {};
    /** `HeapProfiler.getHeapObjectId` */
    export type GetHeapObjectIdRequest = {
      /** Identifier of the object to get heap object id for. */
      objectId: Runtime.RemoteObjectId;
    };
    /** `HeapProfiler.getHeapObjectId` */
    export type GetHeapObjectIdResponse = {
      /** Id of the heap snapshot object corresponding to the passed remote object id. */
      heapSnapshotObjectId: HeapSnapshotObjectId;
    };
    /** `HeapProfiler.getObjectByHeapObjectId` */
    export type GetObjectByHeapObjectIdRequest = {
      objectId: HeapSnapshotObjectId;
      /** Symbolic group name that can be used to release multiple objects. */
      objectGroup?: string;
    };
    /** `HeapProfiler.getObjectByHeapObjectId` */
    export type GetObjectByHeapObjectIdResponse = {
      /** Evaluation result. */
      result: Runtime.RemoteObject;
    };
    /** `HeapProfiler.getSamplingProfile` */
    export type GetSamplingProfileRequest = {};
    /** `HeapProfiler.getSamplingProfile` */
    export type GetSamplingProfileResponse = {
      /** Return the sampling profile being collected. */
      profile: SamplingHeapProfile;
    };
    /** `HeapProfiler.startSampling` */
    export type StartSamplingRequest = {
      /** Average sample interval in bytes. Poisson distribution is used for the intervals. The
default value is 32768 bytes. */
      samplingInterval?: number;
      /** By default, the sampling heap profiler reports only objects which are
still alive when the profile is returned via getSamplingProfile or
stopSampling, which is useful for determining what functions contribute
the most to steady-state memory usage. This flag instructs the sampling
heap profiler to also include information about objects discarded by
major GC, which will show which functions cause large temporary memory
usage or long GC pauses. */
      includeObjectsCollectedByMajorGC?: boolean;
      /** By default, the sampling heap profiler reports only objects which are
still alive when the profile is returned via getSamplingProfile or
stopSampling, which is useful for determining what functions contribute
the most to steady-state memory usage. This flag instructs the sampling
heap profiler to also include information about objects discarded by
minor GC, which is useful when tuning a latency-sensitive application
for minimal GC activity. */
      includeObjectsCollectedByMinorGC?: boolean;
    };
    /** `HeapProfiler.startSampling` */
    export type StartSamplingResponse = {};
    /** `HeapProfiler.startTrackingHeapObjects` */
    export type StartTrackingHeapObjectsRequest = {
      trackAllocations?: boolean;
    };
    /** `HeapProfiler.startTrackingHeapObjects` */
    export type StartTrackingHeapObjectsResponse = {};
    /** `HeapProfiler.stopSampling` */
    export type StopSamplingRequest = {};
    /** `HeapProfiler.stopSampling` */
    export type StopSamplingResponse = {
      /** Recorded sampling heap profile. */
      profile: SamplingHeapProfile;
    };
    /** `HeapProfiler.stopTrackingHeapObjects` */
    export type StopTrackingHeapObjectsRequest = {
      /** If true 'reportHeapSnapshotProgress' events will be generated while snapshot is being taken
when the tracking is stopped. */
      reportProgress?: boolean;
      /** Deprecated in favor of `exposeInternals`. */
      treatGlobalObjectsAsRoots?: boolean;
      /** If true, numerical values are included in the snapshot */
      captureNumericValue?: boolean;
      /** If true, exposes internals of the snapshot. */
      exposeInternals?: boolean;
    };
    /** `HeapProfiler.stopTrackingHeapObjects` */
    export type StopTrackingHeapObjectsResponse = {};
    /** `HeapProfiler.takeHeapSnapshot` */
    export type TakeHeapSnapshotRequest = {
      /** If true 'reportHeapSnapshotProgress' events will be generated while snapshot is being taken. */
      reportProgress?: boolean;
      /** If true, a raw snapshot without artificial roots will be generated.
Deprecated in favor of `exposeInternals`. */
      treatGlobalObjectsAsRoots?: boolean;
      /** If true, numerical values are included in the snapshot */
      captureNumericValue?: boolean;
      /** If true, exposes internals of the snapshot. */
      exposeInternals?: boolean;
    };
    /** `HeapProfiler.takeHeapSnapshot` */
    export type TakeHeapSnapshotResponse = {};
  }
  export namespace Network {
    /** Resource type as it was perceived by the rendering engine. */
    export type ResourceType =
      | "Document"
      | "Stylesheet"
      | "Image"
      | "Media"
      | "Font"
      | "Script"
      | "TextTrack"
      | "XHR"
      | "Fetch"
      | "Prefetch"
      | "EventSource"
      | "WebSocket"
      | "Manifest"
      | "SignedExchange"
      | "Ping"
      | "CSPViolationReport"
      | "Preflight"
      | "Other";
    /** Unique loader identifier. */
    export type LoaderId = string;
    /** Unique request identifier. */
    export type RequestId = string;
    /** Unique intercepted request identifier. */
    export type InterceptionId = string;
    /** Network level fetch failure reason. */
    export type ErrorReason =
      | "Failed"
      | "Aborted"
      | "TimedOut"
      | "AccessDenied"
      | "ConnectionClosed"
      | "ConnectionReset"
      | "ConnectionRefused"
      | "ConnectionAborted"
      | "ConnectionFailed"
      | "NameNotResolved"
      | "InternetDisconnected"
      | "AddressUnreachable"
      | "BlockedByClient"
      | "BlockedByResponse";
    /** UTC time in seconds, counted from January 1, 1970. */
    export type TimeSinceEpoch = number;
    /** Monotonically increasing time in seconds since an arbitrary point in the past. */
    export type MonotonicTime = number;
    /** Request / response headers as keys / values of JSON object. */
    export type Headers = Record<string, unknown>;
    /** The underlying connection technology that the browser is supposedly using. */
    export type ConnectionType =
      | "none"
      | "cellular2g"
      | "cellular3g"
      | "cellular4g"
      | "bluetooth"
      | "ethernet"
      | "wifi"
      | "wimax"
      | "other";
    /** Represents the cookie's 'SameSite' status:
https://tools.ietf.org/html/draft-west-first-party-cookies */
    export type CookieSameSite = "Strict" | "Lax" | "None";
    /** Represents the cookie's 'Priority' status:
https://tools.ietf.org/html/draft-west-cookie-priority-00 */
    export type CookiePriority = "Low" | "Medium" | "High";
    /** Represents the source scheme of the origin that originally set the cookie.
A value of "Unset" allows protocol clients to emulate legacy cookie scope for the scheme.
This is a temporary ability and it will be removed in the future. */
    export type CookieSourceScheme = "Unset" | "NonSecure" | "Secure";
    /** Timing information for the request. */
    export type ResourceTiming = {
      /** Timing's requestTime is a baseline in seconds, while the other numbers are ticks in
milliseconds relatively to this requestTime. */
      requestTime: number;
      /** Started resolving proxy. */
      proxyStart: number;
      /** Finished resolving proxy. */
      proxyEnd: number;
      /** Started DNS address resolve. */
      dnsStart: number;
      /** Finished DNS address resolve. */
      dnsEnd: number;
      /** Started connecting to the remote host. */
      connectStart: number;
      /** Connected to the remote host. */
      connectEnd: number;
      /** Started SSL handshake. */
      sslStart: number;
      /** Finished SSL handshake. */
      sslEnd: number;
      /** Started running ServiceWorker. */
      workerStart: number;
      /** Finished Starting ServiceWorker. */
      workerReady: number;
      /** Started fetch event. */
      workerFetchStart: number;
      /** Settled fetch event respondWith promise. */
      workerRespondWithSettled: number;
      /** Started sending request. */
      sendStart: number;
      /** Finished sending request. */
      sendEnd: number;
      /** Time the server started pushing request. */
      pushStart: number;
      /** Time the server finished pushing request. */
      pushEnd: number;
      /** Finished receiving response headers. */
      receiveHeadersEnd: number;
    };
    /** Loading priority of a resource request. */
    export type ResourcePriority = "VeryLow" | "Low" | "Medium" | "High" | "VeryHigh";
    /** Post data entry for HTTP request */
    export type PostDataEntry = {
      bytes?: string;
    };
    /** HTTP request data. */
    export type Request = {
      /** Request URL (without fragment). */
      url: string;
      /** Fragment of the requested URL starting with hash, if present. */
      urlFragment?: string;
      /** HTTP request method. */
      method: string;
      /** HTTP request headers. */
      headers: Headers;
      /** HTTP POST request data. */
      postData?: string;
      /** True when the request has POST data. Note that postData might still be omitted when this flag is true when the data is too long. */
      hasPostData?: boolean;
      /** Request body elements. This will be converted from base64 to binary */
      postDataEntries?: Array<PostDataEntry>;
      /** The mixed content type of the request. */
      mixedContentType?: unknown;
      /** Priority of the resource request at the time request is sent. */
      initialPriority: ResourcePriority;
      /** The referrer policy of the request, as defined in https://www.w3.org/TR/referrer-policy/ */
      referrerPolicy:
        | "unsafe-url"
        | "no-referrer-when-downgrade"
        | "no-referrer"
        | "origin"
        | "origin-when-cross-origin"
        | "same-origin"
        | "strict-origin"
        | "strict-origin-when-cross-origin";
      /** Whether is loaded via link preload. */
      isLinkPreload?: boolean;
      /** Set for requests when the TrustToken API is used. Contains the parameters
passed by the developer (e.g. via "fetch") as understood by the backend. */
      trustTokenParams?: TrustTokenParams;
      /** True if this resource request is considered to be the 'same site' as the
request correspondinfg to the main frame. */
      isSameSite?: boolean;
    };
    /** Details of a signed certificate timestamp (SCT). */
    export type SignedCertificateTimestamp = {
      /** Validation status. */
      status: string;
      /** Origin. */
      origin: string;
      /** Log name / description. */
      logDescription: string;
      /** Log ID. */
      logId: string;
      /** Issuance date. Unlike TimeSinceEpoch, this contains the number of
milliseconds since January 1, 1970, UTC, not the number of seconds. */
      timestamp: number;
      /** Hash algorithm. */
      hashAlgorithm: string;
      /** Signature algorithm. */
      signatureAlgorithm: string;
      /** Signature data. */
      signatureData: string;
    };
    /** Security details about a request. */
    export type SecurityDetails = {
      /** Protocol name (e.g. "TLS 1.2" or "QUIC"). */
      protocol: string;
      /** Key Exchange used by the connection, or the empty string if not applicable. */
      keyExchange: string;
      /** (EC)DH group used by the connection, if applicable. */
      keyExchangeGroup?: string;
      /** Cipher name. */
      cipher: string;
      /** TLS MAC. Note that AEAD ciphers do not have separate MACs. */
      mac?: string;
      /** Certificate ID value. */
      certificateId: unknown;
      /** Certificate subject name. */
      subjectName: string;
      /** Subject Alternative Name (SAN) DNS names and IP addresses. */
      sanList: Array<string>;
      /** Name of the issuing CA. */
      issuer: string;
      /** Certificate valid from date. */
      validFrom: TimeSinceEpoch;
      /** Certificate valid to (expiration) date */
      validTo: TimeSinceEpoch;
      /** List of signed certificate timestamps (SCTs). */
      signedCertificateTimestampList: Array<SignedCertificateTimestamp>;
      /** Whether the request complied with Certificate Transparency policy */
      certificateTransparencyCompliance: CertificateTransparencyCompliance;
      /** The signature algorithm used by the server in the TLS server signature,
represented as a TLS SignatureScheme code point. Omitted if not
applicable or not known. */
      serverSignatureAlgorithm?: number;
      /** Whether the connection used Encrypted ClientHello */
      encryptedClientHello: boolean;
    };
    /** Whether the request complied with Certificate Transparency policy. */
    export type CertificateTransparencyCompliance = "unknown" | "not-compliant" | "compliant";
    /** The reason why request was blocked. */
    export type BlockedReason =
      | "other"
      | "csp"
      | "mixed-content"
      | "origin"
      | "inspector"
      | "subresource-filter"
      | "content-type"
      | "coep-frame-resource-needs-coep-header"
      | "coop-sandboxed-iframe-cannot-navigate-to-coop-page"
      | "corp-not-same-origin"
      | "corp-not-same-origin-after-defaulted-to-same-origin-by-coep"
      | "corp-not-same-site";
    /** The reason why request was blocked. */
    export type CorsError =
      | "DisallowedByMode"
      | "InvalidResponse"
      | "WildcardOriginNotAllowed"
      | "MissingAllowOriginHeader"
      | "MultipleAllowOriginValues"
      | "InvalidAllowOriginValue"
      | "AllowOriginMismatch"
      | "InvalidAllowCredentials"
      | "CorsDisabledScheme"
      | "PreflightInvalidStatus"
      | "PreflightDisallowedRedirect"
      | "PreflightWildcardOriginNotAllowed"
      | "PreflightMissingAllowOriginHeader"
      | "PreflightMultipleAllowOriginValues"
      | "PreflightInvalidAllowOriginValue"
      | "PreflightAllowOriginMismatch"
      | "PreflightInvalidAllowCredentials"
      | "PreflightMissingAllowExternal"
      | "PreflightInvalidAllowExternal"
      | "PreflightMissingAllowPrivateNetwork"
      | "PreflightInvalidAllowPrivateNetwork"
      | "InvalidAllowMethodsPreflightResponse"
      | "InvalidAllowHeadersPreflightResponse"
      | "MethodDisallowedByPreflightResponse"
      | "HeaderDisallowedByPreflightResponse"
      | "RedirectContainsCredentials"
      | "InsecurePrivateNetwork"
      | "InvalidPrivateNetworkAccess"
      | "UnexpectedPrivateNetworkAccess"
      | "NoCorsRedirectModeNotFollow";
    export type CorsErrorStatus = {
      corsError: CorsError;
      failedParameter: string;
    };
    /** Source of serviceworker response. */
    export type ServiceWorkerResponseSource = "cache-storage" | "http-cache" | "fallback-code" | "network";
    /** Determines what type of Trust Token operation is executed and
depending on the type, some additional parameters. The values
are specified in third_party/blink/renderer/core/fetch/trust_token.idl. */
    export type TrustTokenParams = {
      operation: TrustTokenOperationType;
      /** Only set for "token-redemption" operation and determine whether
to request a fresh SRR or use a still valid cached SRR. */
      refreshPolicy: "UseCached" | "Refresh";
      /** Origins of issuers from whom to request tokens or redemption
records. */
      issuers?: Array<string>;
    };
    export type TrustTokenOperationType = "Issuance" | "Redemption" | "Signing";
    /** The reason why Chrome uses a specific transport protocol for HTTP semantics. */
    export type AlternateProtocolUsage =
      | "alternativeJobWonWithoutRace"
      | "alternativeJobWonRace"
      | "mainJobWonRace"
      | "mappingMissing"
      | "broken"
      | "dnsAlpnH3JobWonWithoutRace"
      | "dnsAlpnH3JobWonRace"
      | "unspecifiedReason";
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
      /** HTTP response headers text. This has been replaced by the headers in Network.responseReceivedExtraInfo. */
      headersText?: string;
      /** Resource mimeType as determined by the browser. */
      mimeType: string;
      /** Refined HTTP request headers that were actually transmitted over the network. */
      requestHeaders?: Headers;
      /** HTTP request headers text. This has been replaced by the headers in Network.requestWillBeSentExtraInfo. */
      requestHeadersText?: string;
      /** Specifies whether physical connection was actually reused for this request. */
      connectionReused: boolean;
      /** Physical connection id that was actually used for this request. */
      connectionId: number;
      /** Remote IP address. */
      remoteIPAddress?: string;
      /** Remote port. */
      remotePort?: number;
      /** Specifies that the request was served from the disk cache. */
      fromDiskCache?: boolean;
      /** Specifies that the request was served from the ServiceWorker. */
      fromServiceWorker?: boolean;
      /** Specifies that the request was served from the prefetch cache. */
      fromPrefetchCache?: boolean;
      /** Total number of bytes received for this request so far. */
      encodedDataLength: number;
      /** Timing information for the given request. */
      timing?: ResourceTiming;
      /** Response source of response from ServiceWorker. */
      serviceWorkerResponseSource?: ServiceWorkerResponseSource;
      /** The time at which the returned response was generated. */
      responseTime?: TimeSinceEpoch;
      /** Cache Storage Cache Name. */
      cacheStorageCacheName?: string;
      /** Protocol used to fetch this request. */
      protocol?: string;
      /** The reason why Chrome uses a specific transport protocol for HTTP semantics. */
      alternateProtocolUsage?: AlternateProtocolUsage;
      /** Security state of the request resource. */
      securityState: unknown;
      /** Security details for the request. */
      securityDetails?: unknown;
    };
    /** WebSocket request data. */
    export type WebSocketRequest = {
      /** HTTP request headers. */
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
      /** HTTP response headers text. */
      headersText?: string;
      /** HTTP request headers. */
      requestHeaders?: Headers;
      /** HTTP request headers text. */
      requestHeadersText?: string;
    };
    /** WebSocket message data. This represents an entire WebSocket message, not just a fragmented frame as the name suggests. */
    export type WebSocketFrame = {
      /** WebSocket message opcode. */
      opcode: number;
      /** WebSocket message mask. */
      mask: boolean;
      /** WebSocket message payload data.
If the opcode is 1, this is a text message and payloadData is a UTF-8 string.
If the opcode isn't 1, then payloadData is a base64 encoded string representing binary data. */
      payloadData: string;
    };
    /** Information about the cached resource. */
    export type CachedResource = {
      /** Resource URL. This is the url of the original network request. */
      url: string;
      /** Type of this resource. */
      type: ResourceType;
      /** Cached response data. */
      response?: Response;
      /** Cached response body size. */
      bodySize: number;
    };
    /** Information about the request initiator. */
    export type Initiator = {
      /** Type of this initiator. */
      type: "parser" | "script" | "preload" | "SignedExchange" | "preflight" | "other";
      /** Initiator JavaScript stack trace, set for Script only. */
      stack?: Runtime.StackTrace;
      /** Initiator URL, set for Parser type or for Script type (when script is importing module) or for SignedExchange type. */
      url?: string;
      /** Initiator line number, set for Parser type or for Script type (when script is importing
module) (0-based). */
      lineNumber?: number;
      /** Initiator column number, set for Parser type or for Script type (when script is importing
module) (0-based). */
      columnNumber?: number;
      /** Set if another request triggered this request (e.g. preflight). */
      requestId?: RequestId;
    };
    /** Cookie object */
    export type Cookie = {
      /** Cookie name. */
      name: string;
      /** Cookie value. */
      value: string;
      /** Cookie domain. */
      domain: string;
      /** Cookie path. */
      path: string;
      /** Cookie expiration date as the number of seconds since the UNIX epoch. */
      expires: number;
      /** Cookie size. */
      size: number;
      /** True if cookie is http-only. */
      httpOnly: boolean;
      /** True if cookie is secure. */
      secure: boolean;
      /** True in case of session cookie. */
      session: boolean;
      /** Cookie SameSite type. */
      sameSite?: CookieSameSite;
      /** Cookie Priority */
      priority: CookiePriority;
      /** True if cookie is SameParty. */
      sameParty: boolean;
      /** Cookie source scheme type. */
      sourceScheme: CookieSourceScheme;
      /** Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.
An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.
This is a temporary ability and it will be removed in the future. */
      sourcePort: number;
      /** Cookie partition key. The site of the top-level URL the browser was visiting at the start
of the request to the endpoint that set the cookie. */
      partitionKey?: string;
      /** True if cookie partition key is opaque. */
      partitionKeyOpaque?: boolean;
    };
    /** Types of reasons why a cookie may not be stored from a response. */
    export type SetCookieBlockedReason =
      | "SecureOnly"
      | "SameSiteStrict"
      | "SameSiteLax"
      | "SameSiteUnspecifiedTreatedAsLax"
      | "SameSiteNoneInsecure"
      | "UserPreferences"
      | "ThirdPartyBlockedInFirstPartySet"
      | "SyntaxError"
      | "SchemeNotSupported"
      | "OverwriteSecure"
      | "InvalidDomain"
      | "InvalidPrefix"
      | "UnknownError"
      | "SchemefulSameSiteStrict"
      | "SchemefulSameSiteLax"
      | "SchemefulSameSiteUnspecifiedTreatedAsLax"
      | "SamePartyFromCrossPartyContext"
      | "SamePartyConflictsWithOtherAttributes"
      | "NameValuePairExceedsMaxSize";
    /** Types of reasons why a cookie may not be sent with a request. */
    export type CookieBlockedReason =
      | "SecureOnly"
      | "NotOnPath"
      | "DomainMismatch"
      | "SameSiteStrict"
      | "SameSiteLax"
      | "SameSiteUnspecifiedTreatedAsLax"
      | "SameSiteNoneInsecure"
      | "UserPreferences"
      | "ThirdPartyBlockedInFirstPartySet"
      | "UnknownError"
      | "SchemefulSameSiteStrict"
      | "SchemefulSameSiteLax"
      | "SchemefulSameSiteUnspecifiedTreatedAsLax"
      | "SamePartyFromCrossPartyContext"
      | "NameValuePairExceedsMaxSize";
    /** A cookie which was not stored from a response with the corresponding reason. */
    export type BlockedSetCookieWithReason = {
      /** The reason(s) this cookie was blocked. */
      blockedReasons: Array<SetCookieBlockedReason>;
      /** The string representing this individual cookie as it would appear in the header.
This is not the entire "cookie" or "set-cookie" header which could have multiple cookies. */
      cookieLine: string;
      /** The cookie object which represents the cookie which was not stored. It is optional because
sometimes complete cookie information is not available, such as in the case of parsing
errors. */
      cookie?: Cookie;
    };
    /** A cookie with was not sent with a request with the corresponding reason. */
    export type BlockedCookieWithReason = {
      /** The reason(s) the cookie was blocked. */
      blockedReasons: Array<CookieBlockedReason>;
      /** The cookie object representing the cookie which was not sent. */
      cookie: Cookie;
    };
    /** Cookie parameter object */
    export type CookieParam = {
      /** Cookie name. */
      name: string;
      /** Cookie value. */
      value: string;
      /** The request-URI to associate with the setting of the cookie. This value can affect the
default domain, path, source port, and source scheme values of the created cookie. */
      url?: string;
      /** Cookie domain. */
      domain?: string;
      /** Cookie path. */
      path?: string;
      /** True if cookie is secure. */
      secure?: boolean;
      /** True if cookie is http-only. */
      httpOnly?: boolean;
      /** Cookie SameSite type. */
      sameSite?: CookieSameSite;
      /** Cookie expiration date, session cookie if not set */
      expires?: TimeSinceEpoch;
      /** Cookie Priority. */
      priority?: CookiePriority;
      /** True if cookie is SameParty. */
      sameParty?: boolean;
      /** Cookie source scheme type. */
      sourceScheme?: CookieSourceScheme;
      /** Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.
An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.
This is a temporary ability and it will be removed in the future. */
      sourcePort?: number;
      /** Cookie partition key. The site of the top-level URL the browser was visiting at the start
of the request to the endpoint that set the cookie.
If not set, the cookie will be set as not partitioned. */
      partitionKey?: string;
    };
    /** Authorization challenge for HTTP status code 401 or 407. */
    export type AuthChallenge = {
      /** Source of the authentication challenge. */
      source?: "Server" | "Proxy";
      /** Origin of the challenger. */
      origin: string;
      /** The authentication scheme used, such as basic or digest */
      scheme: string;
      /** The realm of the challenge. May be empty. */
      realm: string;
    };
    /** Response to an AuthChallenge. */
    export type AuthChallengeResponse = {
      /** The decision on what to do in response to the authorization challenge.  Default means
deferring to the default behavior of the net stack, which will likely either the Cancel
authentication or display a popup dialog box. */
      response: "Default" | "CancelAuth" | "ProvideCredentials";
      /** The username to provide, possibly empty. Should only be set if response is
ProvideCredentials. */
      username?: string;
      /** The password to provide, possibly empty. Should only be set if response is
ProvideCredentials. */
      password?: string;
    };
    /** Stages of the interception to begin intercepting. Request will intercept before the request is
sent. Response will intercept after the response is received. */
    export type InterceptionStage = "Request" | "HeadersReceived";
    /** Request pattern for interception. */
    export type RequestPattern = {
      /** Wildcards (`'*'` -> zero or more, `'?'` -> exactly one) are allowed. Escape character is
backslash. Omitting is equivalent to `"*"`. */
      urlPattern?: string;
      /** If set, only requests for matching resource types will be intercepted. */
      resourceType?: ResourceType;
      /** Stage at which to begin intercepting requests. Default is Request. */
      interceptionStage?: InterceptionStage;
    };
    /** Information about a signed exchange signature.
https://wicg.github.io/webpackage/draft-yasskin-httpbis-origin-signed-exchanges-impl.html#rfc.section.3.1 */
    export type SignedExchangeSignature = {
      /** Signed exchange signature label. */
      label: string;
      /** The hex string of signed exchange signature. */
      signature: string;
      /** Signed exchange signature integrity. */
      integrity: string;
      /** Signed exchange signature cert Url. */
      certUrl?: string;
      /** The hex string of signed exchange signature cert sha256. */
      certSha256?: string;
      /** Signed exchange signature validity Url. */
      validityUrl: string;
      /** Signed exchange signature date. */
      date: number;
      /** Signed exchange signature expires. */
      expires: number;
      /** The encoded certificates. */
      certificates?: Array<string>;
    };
    /** Information about a signed exchange header.
https://wicg.github.io/webpackage/draft-yasskin-httpbis-origin-signed-exchanges-impl.html#cbor-representation */
    export type SignedExchangeHeader = {
      /** Signed exchange request URL. */
      requestUrl: string;
      /** Signed exchange response code. */
      responseCode: number;
      /** Signed exchange response headers. */
      responseHeaders: Headers;
      /** Signed exchange response signature. */
      signatures: Array<SignedExchangeSignature>;
      /** Signed exchange header integrity hash in the form of "sha256-<base64-hash-value>". */
      headerIntegrity: string;
    };
    /** Field type for a signed exchange related error. */
    export type SignedExchangeErrorField =
      | "signatureSig"
      | "signatureIntegrity"
      | "signatureCertUrl"
      | "signatureCertSha256"
      | "signatureValidityUrl"
      | "signatureTimestamps";
    /** Information about a signed exchange response. */
    export type SignedExchangeError = {
      /** Error message. */
      message: string;
      /** The index of the signature which caused the error. */
      signatureIndex?: number;
      /** The field which caused the error. */
      errorField?: SignedExchangeErrorField;
    };
    /** Information about a signed exchange response. */
    export type SignedExchangeInfo = {
      /** The outer response of signed HTTP exchange which was received from network. */
      outerResponse: Response;
      /** Information about the signed exchange header. */
      header?: SignedExchangeHeader;
      /** Security details for the signed exchange header. */
      securityDetails?: unknown;
      /** Errors occurred while handling the signed exchagne. */
      errors?: Array<SignedExchangeError>;
    };
    /** List of content encodings supported by the backend. */
    export type ContentEncoding = "deflate" | "gzip" | "br";
    export type PrivateNetworkRequestPolicy =
      | "Allow"
      | "BlockFromInsecureToMorePrivate"
      | "WarnFromInsecureToMorePrivate"
      | "PreflightBlock"
      | "PreflightWarn";
    export type IPAddressSpace = "Local" | "Private" | "Public" | "Unknown";
    export type ConnectTiming = {
      /** Timing's requestTime is a baseline in seconds, while the other numbers are ticks in
milliseconds relatively to this requestTime. Matches ResourceTiming's requestTime for
the same request (but not for redirected requests). */
      requestTime: number;
    };
    export type ClientSecurityState = {
      initiatorIsSecureContext: boolean;
      initiatorIPAddressSpace: IPAddressSpace;
      privateNetworkRequestPolicy: PrivateNetworkRequestPolicy;
    };
    export type CrossOriginOpenerPolicyValue =
      | "SameOrigin"
      | "SameOriginAllowPopups"
      | "RestrictProperties"
      | "UnsafeNone"
      | "SameOriginPlusCoep"
      | "RestrictPropertiesPlusCoep";
    export type CrossOriginOpenerPolicyStatus = {
      value: CrossOriginOpenerPolicyValue;
      reportOnlyValue: CrossOriginOpenerPolicyValue;
      reportingEndpoint?: string;
      reportOnlyReportingEndpoint?: string;
    };
    export type CrossOriginEmbedderPolicyValue = "None" | "Credentialless" | "RequireCorp";
    export type CrossOriginEmbedderPolicyStatus = {
      value: CrossOriginEmbedderPolicyValue;
      reportOnlyValue: CrossOriginEmbedderPolicyValue;
      reportingEndpoint?: string;
      reportOnlyReportingEndpoint?: string;
    };
    export type SecurityIsolationStatus = {
      coop?: CrossOriginOpenerPolicyStatus;
      coep?: CrossOriginEmbedderPolicyStatus;
    };
    /** The status of a Reporting API report. */
    export type ReportStatus = "Queued" | "Pending" | "MarkedForRemoval" | "Success";
    export type ReportId = string;
    /** An object representing a report generated by the Reporting API. */
    export type ReportingApiReport = {
      id: ReportId;
      /** The URL of the document that triggered the report. */
      initiatorUrl: string;
      /** The name of the endpoint group that should be used to deliver the report. */
      destination: string;
      /** The type of the report (specifies the set of data that is contained in the report body). */
      type: string;
      /** When the report was generated. */
      timestamp: Network.TimeSinceEpoch;
      /** How many uploads deep the related request was. */
      depth: number;
      /** The number of delivery attempts made so far, not including an active attempt. */
      completedAttempts: number;
      body: Record<string, unknown>;
      status: ReportStatus;
    };
    export type ReportingApiEndpoint = {
      /** The URL of the endpoint to which reports may be delivered. */
      url: string;
      /** Name of the endpoint group. */
      groupName: string;
    };
    /** An object providing the result of a network resource load. */
    export type LoadNetworkResourcePageResult = {
      success: boolean;
      /** Optional values used for error reporting. */
      netError?: number;
      netErrorName?: string;
      httpStatusCode?: number;
      /** If successful, one of the following two fields holds the result. */
      stream?: unknown;
      /** Response headers. */
      headers?: Network.Headers;
    };
    /** An options object that may be extended later to better support CORS,
CORB and streaming. */
    export type LoadNetworkResourceOptions = {
      disableCache: boolean;
      includeCredentials: boolean;
    };
    /** `Network.dataReceived` */
    export type DataReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** Data chunk length. */
      dataLength: number;
      /** Actual bytes received (might be less than dataLength for compressed encodings). */
      encodedDataLength: number;
    };
    /** `Network.eventSourceMessageReceived` */
    export type EventSourceMessageReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** Message type. */
      eventName: string;
      /** Message identifier. */
      eventId: string;
      /** Message content. */
      data: string;
    };
    /** `Network.loadingFailed` */
    export type LoadingFailedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** Resource type. */
      type: ResourceType;
      /** User friendly error message. */
      errorText: string;
      /** True if loading was canceled. */
      canceled?: boolean;
      /** The reason why loading was blocked, if any. */
      blockedReason?: BlockedReason;
      /** The reason why loading was blocked by CORS, if any. */
      corsErrorStatus?: CorsErrorStatus;
    };
    /** `Network.loadingFinished` */
    export type LoadingFinishedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** Total number of bytes received for this request. */
      encodedDataLength: number;
      /** Set when 1) response was blocked by Cross-Origin Read Blocking and also
2) this needs to be reported to the DevTools console. */
      shouldReportCorbBlocking?: boolean;
    };
    /** `Network.requestIntercepted` */
    export type RequestInterceptedEvent = {
      /** Each request the page makes will have a unique id, however if any redirects are encountered
while processing that fetch, they will be reported with the same id as the original fetch.
Likewise if HTTP authentication is needed then the same fetch id will be used. */
      interceptionId: InterceptionId;
      request: Request;
      /** The id of the frame that initiated the request. */
      frameId: unknown;
      /** How the requested resource will be used. */
      resourceType: ResourceType;
      /** Whether this is a navigation request, which can abort the navigation completely. */
      isNavigationRequest: boolean;
      /** Set if the request is a navigation that will result in a download.
Only present after response is received from the server (i.e. HeadersReceived stage). */
      isDownload?: boolean;
      /** Redirect location, only sent if a redirect was intercepted. */
      redirectUrl?: string;
      /** Details of the Authorization Challenge encountered. If this is set then
continueInterceptedRequest must contain an authChallengeResponse. */
      authChallenge?: AuthChallenge;
      /** Response error if intercepted at response stage or if redirect occurred while intercepting
request. */
      responseErrorReason?: ErrorReason;
      /** Response code if intercepted at response stage or if redirect occurred while intercepting
request or auth retry occurred. */
      responseStatusCode?: number;
      /** Response headers if intercepted at the response stage or if redirect occurred while
intercepting request or auth retry occurred. */
      responseHeaders?: Headers;
      /** If the intercepted request had a corresponding requestWillBeSent event fired for it, then
this requestId will be the same as the requestId present in the requestWillBeSent event. */
      requestId?: RequestId;
    };
    /** `Network.requestServedFromCache` */
    export type RequestServedFromCacheEvent = {
      /** Request identifier. */
      requestId: RequestId;
    };
    /** `Network.requestWillBeSent` */
    export type RequestWillBeSentEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Loader identifier. Empty string if the request is fetched from worker. */
      loaderId: LoaderId;
      /** URL of the document this request is loaded for. */
      documentURL: string;
      /** Request data. */
      request: Request;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** Timestamp. */
      wallTime: TimeSinceEpoch;
      /** Request initiator. */
      initiator: Initiator;
      /** In the case that redirectResponse is populated, this flag indicates whether
requestWillBeSentExtraInfo and responseReceivedExtraInfo events will be or were emitted
for the request which was just redirected. */
      redirectHasExtraInfo: boolean;
      /** Redirect response data. */
      redirectResponse?: Response;
      /** Type of this resource. */
      type?: ResourceType;
      /** Frame identifier. */
      frameId?: unknown;
      /** Whether the request is initiated by a user gesture. Defaults to false. */
      hasUserGesture?: boolean;
    };
    /** `Network.resourceChangedPriority` */
    export type ResourceChangedPriorityEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** New priority */
      newPriority: ResourcePriority;
      /** Timestamp. */
      timestamp: MonotonicTime;
    };
    /** `Network.signedExchangeReceived` */
    export type SignedExchangeReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Information about the signed exchange response. */
      info: SignedExchangeInfo;
    };
    /** `Network.responseReceived` */
    export type ResponseReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Loader identifier. Empty string if the request is fetched from worker. */
      loaderId: LoaderId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** Resource type. */
      type: ResourceType;
      /** Response data. */
      response: Response;
      /** Indicates whether requestWillBeSentExtraInfo and responseReceivedExtraInfo events will be
or were emitted for this request. */
      hasExtraInfo: boolean;
      /** Frame identifier. */
      frameId?: unknown;
    };
    /** `Network.webSocketClosed` */
    export type WebSocketClosedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
    };
    /** `Network.webSocketCreated` */
    export type WebSocketCreatedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** WebSocket request URL. */
      url: string;
      /** Request initiator. */
      initiator?: Initiator;
    };
    /** `Network.webSocketFrameError` */
    export type WebSocketFrameErrorEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** WebSocket error message. */
      errorMessage: string;
    };
    /** `Network.webSocketFrameReceived` */
    export type WebSocketFrameReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** WebSocket response data. */
      response: WebSocketFrame;
    };
    /** `Network.webSocketFrameSent` */
    export type WebSocketFrameSentEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** WebSocket response data. */
      response: WebSocketFrame;
    };
    /** `Network.webSocketHandshakeResponseReceived` */
    export type WebSocketHandshakeResponseReceivedEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** WebSocket response data. */
      response: WebSocketResponse;
    };
    /** `Network.webSocketWillSendHandshakeRequest` */
    export type WebSocketWillSendHandshakeRequestEvent = {
      /** Request identifier. */
      requestId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** UTC Timestamp. */
      wallTime: TimeSinceEpoch;
      /** WebSocket request data. */
      request: WebSocketRequest;
    };
    /** `Network.webTransportCreated` */
    export type WebTransportCreatedEvent = {
      /** WebTransport identifier. */
      transportId: RequestId;
      /** WebTransport request URL. */
      url: string;
      /** Timestamp. */
      timestamp: MonotonicTime;
      /** Request initiator. */
      initiator?: Initiator;
    };
    /** `Network.webTransportConnectionEstablished` */
    export type WebTransportConnectionEstablishedEvent = {
      /** WebTransport identifier. */
      transportId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
    };
    /** `Network.webTransportClosed` */
    export type WebTransportClosedEvent = {
      /** WebTransport identifier. */
      transportId: RequestId;
      /** Timestamp. */
      timestamp: MonotonicTime;
    };
    /** `Network.requestWillBeSentExtraInfo` */
    export type RequestWillBeSentExtraInfoEvent = {
      /** Request identifier. Used to match this information to an existing requestWillBeSent event. */
      requestId: RequestId;
      /** A list of cookies potentially associated to the requested URL. This includes both cookies sent with
the request and the ones not sent; the latter are distinguished by having blockedReason field set. */
      associatedCookies: Array<BlockedCookieWithReason>;
      /** Raw request headers as they will be sent over the wire. */
      headers: Headers;
      /** Connection timing information for the request. */
      connectTiming: ConnectTiming;
      /** The client security state set for the request. */
      clientSecurityState?: unknown;
      /** Whether the site has partitioned cookies stored in a partition different than the current one. */
      siteHasCookieInOtherPartition?: boolean;
    };
    /** `Network.responseReceivedExtraInfo` */
    export type ResponseReceivedExtraInfoEvent = {
      /** Request identifier. Used to match this information to another responseReceived event. */
      requestId: RequestId;
      /** A list of cookies which were not stored from the response along with the corresponding
reasons for blocking. The cookies here may not be valid due to syntax errors, which
are represented by the invalid cookie line string instead of a proper cookie. */
      blockedCookies: Array<BlockedSetCookieWithReason>;
      /** Raw response headers as they were received over the wire. */
      headers: Headers;
      /** The IP address space of the resource. The address space can only be determined once the transport
established the connection, so we can't send it in `requestWillBeSentExtraInfo`. */
      resourceIPAddressSpace: IPAddressSpace;
      /** The status code of the response. This is useful in cases the request failed and no responseReceived
event is triggered, which is the case for, e.g., CORS errors. This is also the correct status code
for cached requests, where the status in responseReceived is a 200 and this will be 304. */
      statusCode: number;
      /** Raw response header text as it was received over the wire. The raw text may not always be
available, such as in the case of HTTP/2 or QUIC. */
      headersText?: string;
      /** The cookie partition key that will be used to store partitioned cookies set in this response.
Only sent when partitioned cookies are enabled. */
      cookiePartitionKey?: string;
      /** True if partitioned cookies are enabled, but the partition key is not serializeable to string. */
      cookiePartitionKeyOpaque?: boolean;
    };
    /** `Network.trustTokenOperationDone` */
    export type TrustTokenOperationDoneEvent = {
      /** Detailed success or error status of the operation.
'AlreadyExists' also signifies a successful operation, as the result
of the operation already exists und thus, the operation was abort
preemptively (e.g. a cache hit). */
      status:
        | "Ok"
        | "InvalidArgument"
        | "FailedPrecondition"
        | "ResourceExhausted"
        | "AlreadyExists"
        | "Unavailable"
        | "Unauthorized"
        | "BadResponse"
        | "InternalError"
        | "UnknownError"
        | "FulfilledLocally";
      type: TrustTokenOperationType;
      requestId: RequestId;
      /** Top level origin. The context in which the operation was attempted. */
      topLevelOrigin?: string;
      /** Origin of the issuer in case of a "Issuance" or "Redemption" operation. */
      issuerOrigin?: string;
      /** The number of obtained Trust Tokens on a successful "Issuance" operation. */
      issuedTokenCount?: number;
    };
    /** `Network.subresourceWebBundleMetadataReceived` */
    export type SubresourceWebBundleMetadataReceivedEvent = {
      /** Request identifier. Used to match this information to another event. */
      requestId: RequestId;
      /** A list of URLs of resources in the subresource Web Bundle. */
      urls: Array<string>;
    };
    /** `Network.subresourceWebBundleMetadataError` */
    export type SubresourceWebBundleMetadataErrorEvent = {
      /** Request identifier. Used to match this information to another event. */
      requestId: RequestId;
      /** Error message */
      errorMessage: string;
    };
    /** `Network.subresourceWebBundleInnerResponseParsed` */
    export type SubresourceWebBundleInnerResponseParsedEvent = {
      /** Request identifier of the subresource request */
      innerRequestId: RequestId;
      /** URL of the subresource resource. */
      innerRequestURL: string;
      /** Bundle request identifier. Used to match this information to another event.
This made be absent in case when the instrumentation was enabled only
after webbundle was parsed. */
      bundleRequestId?: RequestId;
    };
    /** `Network.subresourceWebBundleInnerResponseError` */
    export type SubresourceWebBundleInnerResponseErrorEvent = {
      /** Request identifier of the subresource request */
      innerRequestId: RequestId;
      /** URL of the subresource resource. */
      innerRequestURL: string;
      /** Error message */
      errorMessage: string;
      /** Bundle request identifier. Used to match this information to another event.
This made be absent in case when the instrumentation was enabled only
after webbundle was parsed. */
      bundleRequestId?: RequestId;
    };
    /** `Network.reportingApiReportAdded` */
    export type ReportingApiReportAddedEvent = {
      report: ReportingApiReport;
    };
    /** `Network.reportingApiReportUpdated` */
    export type ReportingApiReportUpdatedEvent = {
      report: ReportingApiReport;
    };
    /** `Network.reportingApiEndpointsChangedForOrigin` */
    export type ReportingApiEndpointsChangedForOriginEvent = {
      /** Origin of the document(s) which configured the endpoints. */
      origin: string;
      endpoints: Array<ReportingApiEndpoint>;
    };
    /** `Network.setAcceptedEncodings` */
    export type SetAcceptedEncodingsRequest = {
      /** List of accepted content encodings. */
      encodings: Array<ContentEncoding>;
    };
    /** `Network.setAcceptedEncodings` */
    export type SetAcceptedEncodingsResponse = {};
    /** `Network.clearAcceptedEncodingsOverride` */
    export type ClearAcceptedEncodingsOverrideRequest = {};
    /** `Network.clearAcceptedEncodingsOverride` */
    export type ClearAcceptedEncodingsOverrideResponse = {};
    /** `Network.canClearBrowserCache` */
    export type CanClearBrowserCacheRequest = {};
    /** `Network.canClearBrowserCache` */
    export type CanClearBrowserCacheResponse = {
      /** True if browser cache can be cleared. */
      result: boolean;
    };
    /** `Network.canClearBrowserCookies` */
    export type CanClearBrowserCookiesRequest = {};
    /** `Network.canClearBrowserCookies` */
    export type CanClearBrowserCookiesResponse = {
      /** True if browser cookies can be cleared. */
      result: boolean;
    };
    /** `Network.canEmulateNetworkConditions` */
    export type CanEmulateNetworkConditionsRequest = {};
    /** `Network.canEmulateNetworkConditions` */
    export type CanEmulateNetworkConditionsResponse = {
      /** True if emulation of network conditions is supported. */
      result: boolean;
    };
    /** `Network.clearBrowserCache` */
    export type ClearBrowserCacheRequest = {};
    /** `Network.clearBrowserCache` */
    export type ClearBrowserCacheResponse = {};
    /** `Network.clearBrowserCookies` */
    export type ClearBrowserCookiesRequest = {};
    /** `Network.clearBrowserCookies` */
    export type ClearBrowserCookiesResponse = {};
    /** `Network.continueInterceptedRequest` */
    export type ContinueInterceptedRequestRequest = {
      interceptionId: InterceptionId;
      /** If set this causes the request to fail with the given reason. Passing `Aborted` for requests
marked with `isNavigationRequest` also cancels the navigation. Must not be set in response
to an authChallenge. */
      errorReason?: ErrorReason;
      /** If set the requests completes using with the provided base64 encoded raw response, including
HTTP status line and headers etc... Must not be set in response to an authChallenge. (Encoded as a base64 string when passed over JSON) */
      rawResponse?: string;
      /** If set the request url will be modified in a way that's not observable by page. Must not be
set in response to an authChallenge. */
      url?: string;
      /** If set this allows the request method to be overridden. Must not be set in response to an
authChallenge. */
      method?: string;
      /** If set this allows postData to be set. Must not be set in response to an authChallenge. */
      postData?: string;
      /** If set this allows the request headers to be changed. Must not be set in response to an
authChallenge. */
      headers?: Headers;
      /** Response to a requestIntercepted with an authChallenge. Must not be set otherwise. */
      authChallengeResponse?: AuthChallengeResponse;
    };
    /** `Network.continueInterceptedRequest` */
    export type ContinueInterceptedRequestResponse = {};
    /** `Network.deleteCookies` */
    export type DeleteCookiesRequest = {
      /** Name of the cookies to remove. */
      name: string;
      /** If specified, deletes all the cookies with the given name where domain and path match
provided URL. */
      url?: string;
      /** If specified, deletes only cookies with the exact domain. */
      domain?: string;
      /** If specified, deletes only cookies with the exact path. */
      path?: string;
    };
    /** `Network.deleteCookies` */
    export type DeleteCookiesResponse = {};
    /** `Network.disable` */
    export type DisableRequest = {};
    /** `Network.disable` */
    export type DisableResponse = {};
    /** `Network.emulateNetworkConditions` */
    export type EmulateNetworkConditionsRequest = {
      /** True to emulate internet disconnection. */
      offline: boolean;
      /** Minimum latency from request sent to response headers received (ms). */
      latency: number;
      /** Maximal aggregated download throughput (bytes/sec). -1 disables download throttling. */
      downloadThroughput: number;
      /** Maximal aggregated upload throughput (bytes/sec).  -1 disables upload throttling. */
      uploadThroughput: number;
      /** Connection type if known. */
      connectionType?: ConnectionType;
    };
    /** `Network.emulateNetworkConditions` */
    export type EmulateNetworkConditionsResponse = {};
    /** `Network.enable` */
    export type EnableRequest = {
      /** Buffer size in bytes to use when preserving network payloads (XHRs, etc). */
      maxTotalBufferSize?: number;
      /** Per-resource buffer size in bytes to use when preserving network payloads (XHRs, etc). */
      maxResourceBufferSize?: number;
      /** Longest post body size (in bytes) that would be included in requestWillBeSent notification */
      maxPostDataSize?: number;
    };
    /** `Network.enable` */
    export type EnableResponse = {};
    /** `Network.getAllCookies` */
    export type GetAllCookiesRequest = {};
    /** `Network.getAllCookies` */
    export type GetAllCookiesResponse = {
      /** Array of cookie objects. */
      cookies: Array<Cookie>;
    };
    /** `Network.getCertificate` */
    export type GetCertificateRequest = {
      /** Origin to get certificate for. */
      origin: string;
    };
    /** `Network.getCertificate` */
    export type GetCertificateResponse = {
      tableNames: Array<string>;
    };
    /** `Network.getCookies` */
    export type GetCookiesRequest = {
      /** The list of URLs for which applicable cookies will be fetched.
If not specified, it's assumed to be set to the list containing
the URLs of the page and all of its subframes. */
      urls?: Array<string>;
    };
    /** `Network.getCookies` */
    export type GetCookiesResponse = {
      /** Array of cookie objects. */
      cookies: Array<Cookie>;
    };
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
    /** `Network.getRequestPostData` */
    export type GetRequestPostDataRequest = {
      /** Identifier of the network request to get content for. */
      requestId: RequestId;
    };
    /** `Network.getRequestPostData` */
    export type GetRequestPostDataResponse = {
      /** Request body string, omitting files from multipart requests */
      postData: string;
    };
    /** `Network.getResponseBodyForInterception` */
    export type GetResponseBodyForInterceptionRequest = {
      /** Identifier for the intercepted request to get body for. */
      interceptionId: InterceptionId;
    };
    /** `Network.getResponseBodyForInterception` */
    export type GetResponseBodyForInterceptionResponse = {
      /** Response body. */
      body: string;
      /** True, if content was sent as base64. */
      base64Encoded: boolean;
    };
    /** `Network.takeResponseBodyForInterceptionAsStream` */
    export type TakeResponseBodyForInterceptionAsStreamRequest = {
      interceptionId: InterceptionId;
    };
    /** `Network.takeResponseBodyForInterceptionAsStream` */
    export type TakeResponseBodyForInterceptionAsStreamResponse = {
      stream: unknown;
    };
    /** `Network.replayXHR` */
    export type ReplayXHRRequest = {
      /** Identifier of XHR to replay. */
      requestId: RequestId;
    };
    /** `Network.replayXHR` */
    export type ReplayXHRResponse = {};
    /** `Network.searchInResponseBody` */
    export type SearchInResponseBodyRequest = {
      /** Identifier of the network response to search. */
      requestId: RequestId;
      /** String to search for. */
      query: string;
      /** If true, search is case sensitive. */
      caseSensitive?: boolean;
      /** If true, treats string parameter as regex. */
      isRegex?: boolean;
    };
    /** `Network.searchInResponseBody` */
    export type SearchInResponseBodyResponse = {
      /** List of search matches. */
      result: Array<Debugger.SearchMatch>;
    };
    /** `Network.setBlockedURLs` */
    export type SetBlockedURLsRequest = {
      /** URL patterns to block. Wildcards ('*') are allowed. */
      urls: Array<string>;
    };
    /** `Network.setBlockedURLs` */
    export type SetBlockedURLsResponse = {};
    /** `Network.setBypassServiceWorker` */
    export type SetBypassServiceWorkerRequest = {
      /** Bypass service worker and load from network. */
      bypass: boolean;
    };
    /** `Network.setBypassServiceWorker` */
    export type SetBypassServiceWorkerResponse = {};
    /** `Network.setCacheDisabled` */
    export type SetCacheDisabledRequest = {
      /** Cache disabled state. */
      cacheDisabled: boolean;
    };
    /** `Network.setCacheDisabled` */
    export type SetCacheDisabledResponse = {};
    /** `Network.setCookie` */
    export type SetCookieRequest = {
      /** Cookie name. */
      name: string;
      /** Cookie value. */
      value: string;
      /** The request-URI to associate with the setting of the cookie. This value can affect the
default domain, path, source port, and source scheme values of the created cookie. */
      url?: string;
      /** Cookie domain. */
      domain?: string;
      /** Cookie path. */
      path?: string;
      /** True if cookie is secure. */
      secure?: boolean;
      /** True if cookie is http-only. */
      httpOnly?: boolean;
      /** Cookie SameSite type. */
      sameSite?: CookieSameSite;
      /** Cookie expiration date, session cookie if not set */
      expires?: TimeSinceEpoch;
      /** Cookie Priority type. */
      priority?: CookiePriority;
      /** True if cookie is SameParty. */
      sameParty?: boolean;
      /** Cookie source scheme type. */
      sourceScheme?: CookieSourceScheme;
      /** Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.
An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.
This is a temporary ability and it will be removed in the future. */
      sourcePort?: number;
      /** Cookie partition key. The site of the top-level URL the browser was visiting at the start
of the request to the endpoint that set the cookie.
If not set, the cookie will be set as not partitioned. */
      partitionKey?: string;
    };
    /** `Network.setCookie` */
    export type SetCookieResponse = {
      /** Always set to true. If an error occurs, the response indicates protocol error. */
      success: boolean;
    };
    /** `Network.setCookies` */
    export type SetCookiesRequest = {
      /** Cookies to be set. */
      cookies: Array<CookieParam>;
    };
    /** `Network.setCookies` */
    export type SetCookiesResponse = {};
    /** `Network.setExtraHTTPHeaders` */
    export type SetExtraHTTPHeadersRequest = {
      /** Map with extra HTTP headers. */
      headers: Headers;
    };
    /** `Network.setExtraHTTPHeaders` */
    export type SetExtraHTTPHeadersResponse = {};
    /** `Network.setAttachDebugStack` */
    export type SetAttachDebugStackRequest = {
      /** Whether to attach a page script stack for debugging purpose. */
      enabled: boolean;
    };
    /** `Network.setAttachDebugStack` */
    export type SetAttachDebugStackResponse = {};
    /** `Network.setRequestInterception` */
    export type SetRequestInterceptionRequest = {
      /** Requests matching any of these patterns will be forwarded and wait for the corresponding
continueInterceptedRequest call. */
      patterns: Array<RequestPattern>;
    };
    /** `Network.setRequestInterception` */
    export type SetRequestInterceptionResponse = {};
    /** `Network.setUserAgentOverride` */
    export type SetUserAgentOverrideRequest = {
      /** User agent to use. */
      userAgent: string;
      /** Browser langugage to emulate. */
      acceptLanguage?: string;
      /** The platform navigator.platform should return. */
      platform?: string;
      /** To be sent in Sec-CH-UA-* headers and returned in navigator.userAgentData */
      userAgentMetadata?: unknown;
    };
    /** `Network.setUserAgentOverride` */
    export type SetUserAgentOverrideResponse = {};
    /** `Network.getSecurityIsolationStatus` */
    export type GetSecurityIsolationStatusRequest = {
      /** If no frameId is provided, the status of the target is provided. */
      frameId?: unknown;
    };
    /** `Network.getSecurityIsolationStatus` */
    export type GetSecurityIsolationStatusResponse = {
      status: unknown;
    };
    /** `Network.enableReportingApi` */
    export type EnableReportingApiRequest = {
      /** Whether to enable or disable events for the Reporting API */
      enable: boolean;
    };
    /** `Network.enableReportingApi` */
    export type EnableReportingApiResponse = {};
    /** `Network.loadNetworkResource` */
    export type LoadNetworkResourceRequest = {
      /** Frame id to get the resource for. Mandatory for frame targets, and
should be omitted for worker targets. */
      frameId?: unknown;
      /** URL of the resource to get content for. */
      url: string;
      /** Options for the request. */
      options: LoadNetworkResourceOptions;
    };
    /** `Network.loadNetworkResource` */
    export type LoadNetworkResourceResponse = {
      resource: LoadNetworkResourcePageResult;
    };
  }
  export namespace Profiler {
    /** Profile node. Holds callsite information, execution statistics and child nodes. */
    export type ProfileNode = {
      /** Unique id of the node. */
      id: number;
      /** Function location. */
      callFrame: Runtime.CallFrame;
      /** Number of samples where this node was on top of the call stack. */
      hitCount?: number;
      /** Child node ids. */
      children?: Array<number>;
      /** The reason of being not optimized. The function may be deoptimized or marked as don't
optimize. */
      deoptReason?: string;
      /** An array of source position ticks. */
      positionTicks?: Array<PositionTickInfo>;
    };
    /** Profile. */
    export type Profile = {
      /** The list of profile nodes. First item is the root node. */
      nodes: Array<ProfileNode>;
      /** Profiling start timestamp in microseconds. */
      startTime: number;
      /** Profiling end timestamp in microseconds. */
      endTime: number;
      /** Ids of samples top nodes. */
      samples?: Array<number>;
      /** Time intervals between adjacent samples in microseconds. The first delta is relative to the
profile startTime. */
      timeDeltas?: Array<number>;
    };
    /** Specifies a number of samples attributed to a certain source position. */
    export type PositionTickInfo = {
      /** Source line number (1-based). */
      line: number;
      /** Number of samples attributed to the source line. */
      ticks: number;
    };
    /** Coverage data for a source range. */
    export type CoverageRange = {
      /** JavaScript script source offset for the range start. */
      startOffset: number;
      /** JavaScript script source offset for the range end. */
      endOffset: number;
      /** Collected execution count of the source range. */
      count: number;
    };
    /** Coverage data for a JavaScript function. */
    export type FunctionCoverage = {
      /** JavaScript function name. */
      functionName: string;
      /** Source ranges inside the function with coverage data. */
      ranges: Array<CoverageRange>;
      /** Whether coverage data for this function has block granularity. */
      isBlockCoverage: boolean;
    };
    /** Coverage data for a JavaScript script. */
    export type ScriptCoverage = {
      /** JavaScript script id. */
      scriptId: Runtime.ScriptId;
      /** JavaScript script name or url. */
      url: string;
      /** Functions contained in the script that has coverage data. */
      functions: Array<FunctionCoverage>;
    };
    /** `Profiler.consoleProfileFinished` */
    export type ConsoleProfileFinishedEvent = {
      id: string;
      /** Location of console.profileEnd(). */
      location: Debugger.Location;
      profile: Profile;
      /** Profile title passed as an argument to console.profile(). */
      title?: string;
    };
    /** `Profiler.consoleProfileStarted` */
    export type ConsoleProfileStartedEvent = {
      id: string;
      /** Location of console.profile(). */
      location: Debugger.Location;
      /** Profile title passed as an argument to console.profile(). */
      title?: string;
    };
    /** `Profiler.preciseCoverageDeltaUpdate` */
    export type PreciseCoverageDeltaUpdateEvent = {
      /** Monotonically increasing time (in seconds) when the coverage update was taken in the backend. */
      timestamp: number;
      /** Identifier for distinguishing coverage events. */
      occasion: string;
      /** Coverage data for the current isolate. */
      result: Array<ScriptCoverage>;
    };
    /** `Profiler.disable` */
    export type DisableRequest = {};
    /** `Profiler.disable` */
    export type DisableResponse = {};
    /** `Profiler.enable` */
    export type EnableRequest = {};
    /** `Profiler.enable` */
    export type EnableResponse = {};
    /** `Profiler.getBestEffortCoverage` */
    export type GetBestEffortCoverageRequest = {};
    /** `Profiler.getBestEffortCoverage` */
    export type GetBestEffortCoverageResponse = {
      /** Coverage data for the current isolate. */
      result: Array<ScriptCoverage>;
    };
    /** `Profiler.setSamplingInterval` */
    export type SetSamplingIntervalRequest = {
      /** New sampling interval in microseconds. */
      interval: number;
    };
    /** `Profiler.setSamplingInterval` */
    export type SetSamplingIntervalResponse = {};
    /** `Profiler.start` */
    export type StartRequest = {};
    /** `Profiler.start` */
    export type StartResponse = {};
    /** `Profiler.startPreciseCoverage` */
    export type StartPreciseCoverageRequest = {
      /** Collect accurate call counts beyond simple 'covered' or 'not covered'. */
      callCount?: boolean;
      /** Collect block-based coverage. */
      detailed?: boolean;
      /** Allow the backend to send updates on its own initiative */
      allowTriggeredUpdates?: boolean;
    };
    /** `Profiler.startPreciseCoverage` */
    export type StartPreciseCoverageResponse = {
      /** Monotonically increasing time (in seconds) when the coverage update was taken in the backend. */
      timestamp: number;
    };
    /** `Profiler.stop` */
    export type StopRequest = {};
    /** `Profiler.stop` */
    export type StopResponse = {
      /** Recorded profile. */
      profile: Profile;
    };
    /** `Profiler.stopPreciseCoverage` */
    export type StopPreciseCoverageRequest = {};
    /** `Profiler.stopPreciseCoverage` */
    export type StopPreciseCoverageResponse = {};
    /** `Profiler.takePreciseCoverage` */
    export type TakePreciseCoverageRequest = {};
    /** `Profiler.takePreciseCoverage` */
    export type TakePreciseCoverageResponse = {
      /** Coverage data for the current isolate. */
      result: Array<ScriptCoverage>;
      /** Monotonically increasing time (in seconds) when the coverage update was taken in the backend. */
      timestamp: number;
    };
  }
  export namespace Runtime {
    /** Unique script identifier. */
    export type ScriptId = string;
    /** Represents the value serialiazed by the WebDriver BiDi specification
https://w3c.github.io/webdriver-bidi. */
    export type WebDriverValue = {
      type:
        | "undefined"
        | "null"
        | "string"
        | "number"
        | "boolean"
        | "bigint"
        | "regexp"
        | "date"
        | "symbol"
        | "array"
        | "object"
        | "function"
        | "map"
        | "set"
        | "weakmap"
        | "weakset"
        | "error"
        | "proxy"
        | "promise"
        | "typedarray"
        | "arraybuffer"
        | "node"
        | "window";
      value?: any;
      objectId?: string;
    };
    /** Unique object identifier. */
    export type RemoteObjectId = string;
    /** Primitive value which cannot be JSON-stringified. Includes values `-0`, `NaN`, `Infinity`,
`-Infinity`, and bigint literals. */
    export type UnserializableValue = string;
    /** Mirror object referencing original JavaScript object. */
    export type RemoteObject = {
      /** Object type. */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
      /** Object subtype hint. Specified for `object` type values only.
NOTE: If you change anything here, make sure to also update
`subtype` in `ObjectPreview` and `PropertyPreview` below. */
      subtype?:
        | "array"
        | "null"
        | "node"
        | "regexp"
        | "date"
        | "map"
        | "set"
        | "weakmap"
        | "weakset"
        | "iterator"
        | "generator"
        | "error"
        | "proxy"
        | "promise"
        | "typedarray"
        | "arraybuffer"
        | "dataview"
        | "webassemblymemory"
        | "wasmvalue";
      /** Object class (constructor) name. Specified for `object` type values only. */
      className?: string;
      /** Remote object value in case of primitive values or JSON values (if it was requested). */
      value?: any;
      /** Primitive value which can not be JSON-stringified does not have `value`, but gets this
property. */
      unserializableValue?: UnserializableValue;
      /** String representation of the object. */
      description?: string;
      /** WebDriver BiDi representation of the value. */
      webDriverValue?: WebDriverValue;
      /** Unique object identifier (for non-primitive values). */
      objectId?: RemoteObjectId;
      /** Preview containing abbreviated property values. Specified for `object` type values only. */
      preview?: ObjectPreview;
      customPreview?: CustomPreview;
    };
    export type CustomPreview = {
      /** The JSON-stringified result of formatter.header(object, config) call.
It contains json ML array that represents RemoteObject. */
      header: string;
      /** If formatter returns true as a result of formatter.hasBody call then bodyGetterId will
contain RemoteObjectId for the function that returns result of formatter.body(object, config) call.
The result value is json ML array. */
      bodyGetterId?: RemoteObjectId;
    };
    /** Object containing abbreviated remote object value. */
    export type ObjectPreview = {
      /** Object type. */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
      /** Object subtype hint. Specified for `object` type values only. */
      subtype?:
        | "array"
        | "null"
        | "node"
        | "regexp"
        | "date"
        | "map"
        | "set"
        | "weakmap"
        | "weakset"
        | "iterator"
        | "generator"
        | "error"
        | "proxy"
        | "promise"
        | "typedarray"
        | "arraybuffer"
        | "dataview"
        | "webassemblymemory"
        | "wasmvalue";
      /** String representation of the object. */
      description?: string;
      /** True iff some of the properties or entries of the original object did not fit. */
      overflow: boolean;
      /** List of the properties. */
      properties: Array<PropertyPreview>;
      /** List of the entries. Specified for `map` and `set` subtype values only. */
      entries?: Array<EntryPreview>;
    };
    export type PropertyPreview = {
      /** Property name. */
      name: string;
      /** Object type. Accessor means that the property itself is an accessor property. */
      type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "accessor" | "bigint";
      /** User-friendly property value string. */
      value?: string;
      /** Nested value preview. */
      valuePreview?: ObjectPreview;
      /** Object subtype hint. Specified for `object` type values only. */
      subtype?:
        | "array"
        | "null"
        | "node"
        | "regexp"
        | "date"
        | "map"
        | "set"
        | "weakmap"
        | "weakset"
        | "iterator"
        | "generator"
        | "error"
        | "proxy"
        | "promise"
        | "typedarray"
        | "arraybuffer"
        | "dataview"
        | "webassemblymemory"
        | "wasmvalue";
    };
    export type EntryPreview = {
      /** Preview of the key. Specified for map-like collection entries. */
      key?: ObjectPreview;
      /** Preview of the value. */
      value: ObjectPreview;
    };
    /** Object property descriptor. */
    export type PropertyDescriptor = {
      /** Property name or symbol description. */
      name: string;
      /** The value associated with the property. */
      value?: RemoteObject;
      /** True if the value associated with the property may be changed (data descriptors only). */
      writable?: boolean;
      /** A function which serves as a getter for the property, or `undefined` if there is no getter
(accessor descriptors only). */
      get?: RemoteObject;
      /** A function which serves as a setter for the property, or `undefined` if there is no setter
(accessor descriptors only). */
      set?: RemoteObject;
      /** True if the type of this property descriptor may be changed and if the property may be
deleted from the corresponding object. */
      configurable: boolean;
      /** True if this property shows up during enumeration of the properties on the corresponding
object. */
      enumerable: boolean;
      /** True if the result was thrown during the evaluation. */
      wasThrown?: boolean;
      /** True if the property is owned for the object. */
      isOwn?: boolean;
      /** Property symbol object, if the property is of the `symbol` type. */
      symbol?: RemoteObject;
    };
    /** Object internal property descriptor. This property isn't normally visible in JavaScript code. */
    export type InternalPropertyDescriptor = {
      /** Conventional property name. */
      name: string;
      /** The value associated with the property. */
      value?: RemoteObject;
    };
    /** Object private field descriptor. */
    export type PrivatePropertyDescriptor = {
      /** Private property name. */
      name: string;
      /** The value associated with the private property. */
      value?: RemoteObject;
      /** A function which serves as a getter for the private property,
or `undefined` if there is no getter (accessor descriptors only). */
      get?: RemoteObject;
      /** A function which serves as a setter for the private property,
or `undefined` if there is no setter (accessor descriptors only). */
      set?: RemoteObject;
    };
    /** Represents function call argument. Either remote object id `objectId`, primitive `value`,
unserializable primitive value or neither of (for undefined) them should be specified. */
    export type CallArgument = {
      /** Primitive value or serializable javascript object. */
      value?: any;
      /** Primitive value which can not be JSON-stringified. */
      unserializableValue?: UnserializableValue;
      /** Remote object handle. */
      objectId?: RemoteObjectId;
    };
    /** Id of an execution context. */
    export type ExecutionContextId = number;
    /** Description of an isolated world. */
    export type ExecutionContextDescription = {
      /** Unique id of the execution context. It can be used to specify in which execution context
script evaluation should be performed. */
      id: ExecutionContextId;
      /** Execution context origin. */
      origin: string;
      /** Human readable name describing given context. */
      name: string;
      /** A system-unique execution context identifier. Unlike the id, this is unique across
multiple processes, so can be reliably used to identify specific context while backend
performs a cross-process navigation. */
      uniqueId: string;
      /** Embedder-specific auxiliary data. */
      auxData?: Record<string, unknown>;
    };
    /** Detailed information about exception (or error) that was thrown during script compilation or
execution. */
    export type ExceptionDetails = {
      /** Exception id. */
      exceptionId: number;
      /** Exception text, which should be used together with exception object when available. */
      text: string;
      /** Line number of the exception location (0-based). */
      lineNumber: number;
      /** Column number of the exception location (0-based). */
      columnNumber: number;
      /** Script ID of the exception location. */
      scriptId?: ScriptId;
      /** URL of the exception location, to be used when the script was not reported. */
      url?: string;
      /** JavaScript stack trace if available. */
      stackTrace?: StackTrace;
      /** Exception object if available. */
      exception?: RemoteObject;
      /** Identifier of the context where exception happened. */
      executionContextId?: ExecutionContextId;
      /** Dictionary with entries of meta data that the client associated
with this exception, such as information about associated network
requests, etc. */
      exceptionMetaData?: Record<string, unknown>;
    };
    /** Number of milliseconds since epoch. */
    export type Timestamp = number;
    /** Number of milliseconds. */
    export type TimeDelta = number;
    /** Stack entry for runtime errors and assertions. */
    export type CallFrame = {
      /** JavaScript function name. */
      functionName: string;
      /** JavaScript script id. */
      scriptId: ScriptId;
      /** JavaScript script name or url. */
      url: string;
      /** JavaScript script line number (0-based). */
      lineNumber: number;
      /** JavaScript script column number (0-based). */
      columnNumber: number;
    };
    /** Call frames for assertions or error messages. */
    export type StackTrace = {
      /** String label of this stack trace. For async traces this may be a name of the function that
initiated the async call. */
      description?: string;
      /** JavaScript function name. */
      callFrames: Array<CallFrame>;
      /** Asynchronous JavaScript stack trace that preceded this stack, if available. */
      parent?: StackTrace;
      /** Asynchronous JavaScript stack trace that preceded this stack, if available. */
      parentId?: StackTraceId;
    };
    /** Unique identifier of current debugger. */
    export type UniqueDebuggerId = string;
    /** If `debuggerId` is set stack trace comes from another debugger and can be resolved there. This
allows to track cross-debugger calls. See `Runtime.StackTrace` and `Debugger.paused` for usages. */
    export type StackTraceId = {
      id: string;
      debuggerId?: UniqueDebuggerId;
    };
    /** `Runtime.bindingCalled` */
    export type BindingCalledEvent = {
      name: string;
      payload: string;
      /** Identifier of the context where the call was made. */
      executionContextId: ExecutionContextId;
    };
    /** `Runtime.consoleAPICalled` */
    export type ConsoleAPICalledEvent = {
      /** Type of the call. */
      type:
        | "log"
        | "debug"
        | "info"
        | "error"
        | "warning"
        | "dir"
        | "dirxml"
        | "table"
        | "trace"
        | "clear"
        | "startGroup"
        | "startGroupCollapsed"
        | "endGroup"
        | "assert"
        | "profile"
        | "profileEnd"
        | "count"
        | "timeEnd";
      /** Call arguments. */
      args: Array<RemoteObject>;
      /** Identifier of the context where the call was made. */
      executionContextId: ExecutionContextId;
      /** Call timestamp. */
      timestamp: Timestamp;
      /** Stack trace captured when the call was made. The async stack chain is automatically reported for
the following call types: `assert`, `error`, `trace`, `warning`. For other types the async call
chain can be retrieved using `Debugger.getStackTrace` and `stackTrace.parentId` field. */
      stackTrace?: StackTrace;
      /** Console context descriptor for calls on non-default console context (not console.*):
'anonymous#unique-logger-id' for call on unnamed context, 'name#unique-logger-id' for call
on named context. */
      context?: string;
    };
    /** `Runtime.exceptionRevoked` */
    export type ExceptionRevokedEvent = {
      /** Reason describing why exception was revoked. */
      reason: string;
      /** The id of revoked exception, as reported in `exceptionThrown`. */
      exceptionId: number;
    };
    /** `Runtime.exceptionThrown` */
    export type ExceptionThrownEvent = {
      /** Timestamp of the exception. */
      timestamp: Timestamp;
      exceptionDetails: ExceptionDetails;
    };
    /** `Runtime.executionContextCreated` */
    export type ExecutionContextCreatedEvent = {
      /** A newly created execution context. */
      context: ExecutionContextDescription;
    };
    /** `Runtime.executionContextDestroyed` */
    export type ExecutionContextDestroyedEvent = {
      /** Id of the destroyed context */
      executionContextId: ExecutionContextId;
      /** Unique Id of the destroyed context */
      executionContextUniqueId: string;
    };
    /** `Runtime.executionContextsCleared` */
    export type ExecutionContextsClearedEvent = {};
    /** `Runtime.inspectRequested` */
    export type InspectRequestedEvent = {
      object: RemoteObject;
      hints: Record<string, unknown>;
      /** Identifier of the context where the call was made. */
      executionContextId?: ExecutionContextId;
    };
    /** `Runtime.awaitPromise` */
    export type AwaitPromiseRequest = {
      /** Identifier of the promise. */
      promiseObjectId: RemoteObjectId;
      /** Whether the result is expected to be a JSON object that should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
    };
    /** `Runtime.awaitPromise` */
    export type AwaitPromiseResponse = {
      /** Promise result. Will contain rejected value if promise was rejected. */
      result: RemoteObject;
      /** Exception details if stack strace is available. */
      exceptionDetails?: ExceptionDetails;
    };
    /** `Runtime.callFunctionOn` */
    export type CallFunctionOnRequest = {
      /** Declaration of the function to call. */
      functionDeclaration: string;
      /** Identifier of the object to call function on. Either objectId or executionContextId should
be specified. */
      objectId?: RemoteObjectId;
      /** Call arguments. All call arguments must belong to the same JavaScript world as the target
object. */
      arguments?: Array<CallArgument>;
      /** In silent mode exceptions thrown during evaluation are not reported and do not pause
execution. Overrides `setPauseOnException` state. */
      silent?: boolean;
      /** Whether the result is expected to be a JSON object which should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
      /** Whether execution should be treated as initiated by user in the UI. */
      userGesture?: boolean;
      /** Whether execution should `await` for resulting value and return once awaited promise is
resolved. */
      awaitPromise?: boolean;
      /** Specifies execution context which global object will be used to call function on. Either
executionContextId or objectId should be specified. */
      executionContextId?: ExecutionContextId;
      /** Symbolic group name that can be used to release multiple objects. If objectGroup is not
specified and objectId is, objectGroup will be inherited from object. */
      objectGroup?: string;
      /** Whether to throw an exception if side effect cannot be ruled out during evaluation. */
      throwOnSideEffect?: boolean;
      /** An alternative way to specify the execution context to call function on.
Compared to contextId that may be reused across processes, this is guaranteed to be
system-unique, so it can be used to prevent accidental function call
in context different than intended (e.g. as a result of navigation across process
boundaries).
This is mutually exclusive with `executionContextId`. */
      uniqueContextId?: string;
      /** Whether the result should contain `webDriverValue`, serialized according to
https://w3c.github.io/webdriver-bidi. This is mutually exclusive with `returnByValue`, but
resulting `objectId` is still provided. */
      generateWebDriverValue?: boolean;
    };
    /** `Runtime.callFunctionOn` */
    export type CallFunctionOnResponse = {
      /** Call result. */
      result: RemoteObject;
      /** Exception details. */
      exceptionDetails?: ExceptionDetails;
    };
    /** `Runtime.compileScript` */
    export type CompileScriptRequest = {
      /** Expression to compile. */
      expression: string;
      /** Source url to be set for the script. */
      sourceURL: string;
      /** Specifies whether the compiled script should be persisted. */
      persistScript: boolean;
      /** Specifies in which execution context to perform script run. If the parameter is omitted the
evaluation will be performed in the context of the inspected page. */
      executionContextId?: ExecutionContextId;
    };
    /** `Runtime.compileScript` */
    export type CompileScriptResponse = {
      /** Id of the script. */
      scriptId?: ScriptId;
      /** Exception details. */
      exceptionDetails?: ExceptionDetails;
    };
    /** `Runtime.disable` */
    export type DisableRequest = {};
    /** `Runtime.disable` */
    export type DisableResponse = {};
    /** `Runtime.discardConsoleEntries` */
    export type DiscardConsoleEntriesRequest = {};
    /** `Runtime.discardConsoleEntries` */
    export type DiscardConsoleEntriesResponse = {};
    /** `Runtime.enable` */
    export type EnableRequest = {};
    /** `Runtime.enable` */
    export type EnableResponse = {};
    /** `Runtime.evaluate` */
    export type EvaluateRequest = {
      /** Expression to evaluate. */
      expression: string;
      /** Symbolic group name that can be used to release multiple objects. */
      objectGroup?: string;
      /** Determines whether Command Line API should be available during the evaluation. */
      includeCommandLineAPI?: boolean;
      /** In silent mode exceptions thrown during evaluation are not reported and do not pause
execution. Overrides `setPauseOnException` state. */
      silent?: boolean;
      /** Specifies in which execution context to perform evaluation. If the parameter is omitted the
evaluation will be performed in the context of the inspected page.
This is mutually exclusive with `uniqueContextId`, which offers an
alternative way to identify the execution context that is more reliable
in a multi-process environment. */
      contextId?: ExecutionContextId;
      /** Whether the result is expected to be a JSON object that should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
      /** Whether execution should be treated as initiated by user in the UI. */
      userGesture?: boolean;
      /** Whether execution should `await` for resulting value and return once awaited promise is
resolved. */
      awaitPromise?: boolean;
      /** Whether to throw an exception if side effect cannot be ruled out during evaluation.
This implies `disableBreaks` below. */
      throwOnSideEffect?: boolean;
      /** Terminate execution after timing out (number of milliseconds). */
      timeout?: TimeDelta;
      /** Disable breakpoints during execution. */
      disableBreaks?: boolean;
      /** Setting this flag to true enables `let` re-declaration and top-level `await`.
Note that `let` variables can only be re-declared if they originate from
`replMode` themselves. */
      replMode?: boolean;
      /** The Content Security Policy (CSP) for the target might block 'unsafe-eval'
which includes eval(), Function(), setTimeout() and setInterval()
when called with non-callable arguments. This flag bypasses CSP for this
evaluation and allows unsafe-eval. Defaults to true. */
      allowUnsafeEvalBlockedByCSP?: boolean;
      /** An alternative way to specify the execution context to evaluate in.
Compared to contextId that may be reused across processes, this is guaranteed to be
system-unique, so it can be used to prevent accidental evaluation of the expression
in context different than intended (e.g. as a result of navigation across process
boundaries).
This is mutually exclusive with `contextId`. */
      uniqueContextId?: string;
      /** Whether the result should be serialized according to https://w3c.github.io/webdriver-bidi. */
      generateWebDriverValue?: boolean;
    };
    /** `Runtime.evaluate` */
    export type EvaluateResponse = {
      /** Evaluation result. */
      result: RemoteObject;
      /** Exception details. */
      exceptionDetails?: ExceptionDetails;
    };
    /** `Runtime.getIsolateId` */
    export type GetIsolateIdRequest = {};
    /** `Runtime.getIsolateId` */
    export type GetIsolateIdResponse = {
      /** The isolate id. */
      id: string;
    };
    /** `Runtime.getHeapUsage` */
    export type GetHeapUsageRequest = {};
    /** `Runtime.getHeapUsage` */
    export type GetHeapUsageResponse = {
      /** Used heap size in bytes. */
      usedSize: number;
      /** Allocated heap size in bytes. */
      totalSize: number;
    };
    /** `Runtime.getProperties` */
    export type GetPropertiesRequest = {
      /** Identifier of the object to return properties for. */
      objectId: RemoteObjectId;
      /** If true, returns properties belonging only to the element itself, not to its prototype
chain. */
      ownProperties?: boolean;
      /** If true, returns accessor properties (with getter/setter) only; internal properties are not
returned either. */
      accessorPropertiesOnly?: boolean;
      /** Whether preview should be generated for the results. */
      generatePreview?: boolean;
      /** If true, returns non-indexed properties only. */
      nonIndexedPropertiesOnly?: boolean;
    };
    /** `Runtime.getProperties` */
    export type GetPropertiesResponse = {
      /** Object properties. */
      result: Array<PropertyDescriptor>;
      /** Internal object properties (only of the element itself). */
      internalProperties?: Array<InternalPropertyDescriptor>;
      /** Object private properties. */
      privateProperties?: Array<PrivatePropertyDescriptor>;
      /** Exception details. */
      exceptionDetails?: ExceptionDetails;
    };
    /** `Runtime.globalLexicalScopeNames` */
    export type GlobalLexicalScopeNamesRequest = {
      /** Specifies in which execution context to lookup global scope variables. */
      executionContextId?: ExecutionContextId;
    };
    /** `Runtime.globalLexicalScopeNames` */
    export type GlobalLexicalScopeNamesResponse = {
      names: Array<string>;
    };
    /** `Runtime.queryObjects` */
    export type QueryObjectsRequest = {
      /** Identifier of the prototype to return objects for. */
      prototypeObjectId: RemoteObjectId;
      /** Symbolic group name that can be used to release the results. */
      objectGroup?: string;
    };
    /** `Runtime.queryObjects` */
    export type QueryObjectsResponse = {
      /** Array with objects. */
      objects: RemoteObject;
    };
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
    /** `Runtime.runIfWaitingForDebugger` */
    export type RunIfWaitingForDebuggerRequest = {};
    /** `Runtime.runIfWaitingForDebugger` */
    export type RunIfWaitingForDebuggerResponse = {};
    /** `Runtime.runScript` */
    export type RunScriptRequest = {
      /** Id of the script to run. */
      scriptId: ScriptId;
      /** Specifies in which execution context to perform script run. If the parameter is omitted the
evaluation will be performed in the context of the inspected page. */
      executionContextId?: ExecutionContextId;
      /** Symbolic group name that can be used to release multiple objects. */
      objectGroup?: string;
      /** In silent mode exceptions thrown during evaluation are not reported and do not pause
execution. Overrides `setPauseOnException` state. */
      silent?: boolean;
      /** Determines whether Command Line API should be available during the evaluation. */
      includeCommandLineAPI?: boolean;
      /** Whether the result is expected to be a JSON object which should be sent by value. */
      returnByValue?: boolean;
      /** Whether preview should be generated for the result. */
      generatePreview?: boolean;
      /** Whether execution should `await` for resulting value and return once awaited promise is
resolved. */
      awaitPromise?: boolean;
    };
    /** `Runtime.runScript` */
    export type RunScriptResponse = {
      /** Run result. */
      result: RemoteObject;
      /** Exception details. */
      exceptionDetails?: ExceptionDetails;
    };
    /** `Runtime.setAsyncCallStackDepth` */
    export type SetAsyncCallStackDepthRequest = {
      /** Maximum depth of async call stacks. Setting to `0` will effectively disable collecting async
call stacks (default). */
      maxDepth: number;
    };
    /** `Runtime.setAsyncCallStackDepth` */
    export type SetAsyncCallStackDepthResponse = {};
    /** `Runtime.setCustomObjectFormatterEnabled` */
    export type SetCustomObjectFormatterEnabledRequest = {
      enabled: boolean;
    };
    /** `Runtime.setCustomObjectFormatterEnabled` */
    export type SetCustomObjectFormatterEnabledResponse = {};
    /** `Runtime.setMaxCallStackSizeToCapture` */
    export type SetMaxCallStackSizeToCaptureRequest = {
      size: number;
    };
    /** `Runtime.setMaxCallStackSizeToCapture` */
    export type SetMaxCallStackSizeToCaptureResponse = {};
    /** `Runtime.terminateExecution` */
    export type TerminateExecutionRequest = {};
    /** `Runtime.terminateExecution` */
    export type TerminateExecutionResponse = {};
    /** `Runtime.addBinding` */
    export type AddBindingRequest = {
      name: string;
      /** If specified, the binding would only be exposed to the specified
execution context. If omitted and `executionContextName` is not set,
the binding is exposed to all execution contexts of the target.
This parameter is mutually exclusive with `executionContextName`.
Deprecated in favor of `executionContextName` due to an unclear use case
and bugs in implementation (crbug.com/1169639). `executionContextId` will be
removed in the future. */
      executionContextId?: ExecutionContextId;
      /** If specified, the binding is exposed to the executionContext with
matching name, even for contexts created after the binding is added.
See also `ExecutionContext.name` and `worldName` parameter to
`Page.addScriptToEvaluateOnNewDocument`.
This parameter is mutually exclusive with `executionContextId`. */
      executionContextName?: string;
    };
    /** `Runtime.addBinding` */
    export type AddBindingResponse = {};
    /** `Runtime.removeBinding` */
    export type RemoveBindingRequest = {
      name: string;
    };
    /** `Runtime.removeBinding` */
    export type RemoveBindingResponse = {};
    /** `Runtime.getExceptionDetails` */
    export type GetExceptionDetailsRequest = {
      /** The error object for which to resolve the exception details. */
      errorObjectId: RemoteObjectId;
    };
    /** `Runtime.getExceptionDetails` */
    export type GetExceptionDetailsResponse = {
      exceptionDetails?: ExceptionDetails;
    };
  }
  export type EventMap = {
    "Console.messageAdded": Console.MessageAddedEvent;
    "Debugger.breakpointResolved": Debugger.BreakpointResolvedEvent;
    "Debugger.paused": Debugger.PausedEvent;
    "Debugger.resumed": Debugger.ResumedEvent;
    "Debugger.scriptFailedToParse": Debugger.ScriptFailedToParseEvent;
    "Debugger.scriptParsed": Debugger.ScriptParsedEvent;
    "HeapProfiler.addHeapSnapshotChunk": HeapProfiler.AddHeapSnapshotChunkEvent;
    "HeapProfiler.heapStatsUpdate": HeapProfiler.HeapStatsUpdateEvent;
    "HeapProfiler.lastSeenObjectId": HeapProfiler.LastSeenObjectIdEvent;
    "HeapProfiler.reportHeapSnapshotProgress": HeapProfiler.ReportHeapSnapshotProgressEvent;
    "HeapProfiler.resetProfiles": HeapProfiler.ResetProfilesEvent;
    "Network.dataReceived": Network.DataReceivedEvent;
    "Network.eventSourceMessageReceived": Network.EventSourceMessageReceivedEvent;
    "Network.loadingFailed": Network.LoadingFailedEvent;
    "Network.loadingFinished": Network.LoadingFinishedEvent;
    "Network.requestIntercepted": Network.RequestInterceptedEvent;
    "Network.requestServedFromCache": Network.RequestServedFromCacheEvent;
    "Network.requestWillBeSent": Network.RequestWillBeSentEvent;
    "Network.resourceChangedPriority": Network.ResourceChangedPriorityEvent;
    "Network.signedExchangeReceived": Network.SignedExchangeReceivedEvent;
    "Network.responseReceived": Network.ResponseReceivedEvent;
    "Network.webSocketClosed": Network.WebSocketClosedEvent;
    "Network.webSocketCreated": Network.WebSocketCreatedEvent;
    "Network.webSocketFrameError": Network.WebSocketFrameErrorEvent;
    "Network.webSocketFrameReceived": Network.WebSocketFrameReceivedEvent;
    "Network.webSocketFrameSent": Network.WebSocketFrameSentEvent;
    "Network.webSocketHandshakeResponseReceived": Network.WebSocketHandshakeResponseReceivedEvent;
    "Network.webSocketWillSendHandshakeRequest": Network.WebSocketWillSendHandshakeRequestEvent;
    "Network.webTransportCreated": Network.WebTransportCreatedEvent;
    "Network.webTransportConnectionEstablished": Network.WebTransportConnectionEstablishedEvent;
    "Network.webTransportClosed": Network.WebTransportClosedEvent;
    "Network.requestWillBeSentExtraInfo": Network.RequestWillBeSentExtraInfoEvent;
    "Network.responseReceivedExtraInfo": Network.ResponseReceivedExtraInfoEvent;
    "Network.trustTokenOperationDone": Network.TrustTokenOperationDoneEvent;
    "Network.subresourceWebBundleMetadataReceived": Network.SubresourceWebBundleMetadataReceivedEvent;
    "Network.subresourceWebBundleMetadataError": Network.SubresourceWebBundleMetadataErrorEvent;
    "Network.subresourceWebBundleInnerResponseParsed": Network.SubresourceWebBundleInnerResponseParsedEvent;
    "Network.subresourceWebBundleInnerResponseError": Network.SubresourceWebBundleInnerResponseErrorEvent;
    "Network.reportingApiReportAdded": Network.ReportingApiReportAddedEvent;
    "Network.reportingApiReportUpdated": Network.ReportingApiReportUpdatedEvent;
    "Network.reportingApiEndpointsChangedForOrigin": Network.ReportingApiEndpointsChangedForOriginEvent;
    "Profiler.consoleProfileFinished": Profiler.ConsoleProfileFinishedEvent;
    "Profiler.consoleProfileStarted": Profiler.ConsoleProfileStartedEvent;
    "Profiler.preciseCoverageDeltaUpdate": Profiler.PreciseCoverageDeltaUpdateEvent;
    "Runtime.bindingCalled": Runtime.BindingCalledEvent;
    "Runtime.consoleAPICalled": Runtime.ConsoleAPICalledEvent;
    "Runtime.exceptionRevoked": Runtime.ExceptionRevokedEvent;
    "Runtime.exceptionThrown": Runtime.ExceptionThrownEvent;
    "Runtime.executionContextCreated": Runtime.ExecutionContextCreatedEvent;
    "Runtime.executionContextDestroyed": Runtime.ExecutionContextDestroyedEvent;
    "Runtime.executionContextsCleared": Runtime.ExecutionContextsClearedEvent;
    "Runtime.inspectRequested": Runtime.InspectRequestedEvent;
  };
  export type RequestMap = {
    "Console.clearMessages": Console.ClearMessagesRequest;
    "Console.disable": Console.DisableRequest;
    "Console.enable": Console.EnableRequest;
    "Debugger.continueToLocation": Debugger.ContinueToLocationRequest;
    "Debugger.disable": Debugger.DisableRequest;
    "Debugger.enable": Debugger.EnableRequest;
    "Debugger.evaluateOnCallFrame": Debugger.EvaluateOnCallFrameRequest;
    "Debugger.getPossibleBreakpoints": Debugger.GetPossibleBreakpointsRequest;
    "Debugger.getScriptSource": Debugger.GetScriptSourceRequest;
    "Debugger.disassembleWasmModule": Debugger.DisassembleWasmModuleRequest;
    "Debugger.nextWasmDisassemblyChunk": Debugger.NextWasmDisassemblyChunkRequest;
    "Debugger.getWasmBytecode": Debugger.GetWasmBytecodeRequest;
    "Debugger.getStackTrace": Debugger.GetStackTraceRequest;
    "Debugger.pause": Debugger.PauseRequest;
    "Debugger.pauseOnAsyncCall": Debugger.PauseOnAsyncCallRequest;
    "Debugger.removeBreakpoint": Debugger.RemoveBreakpointRequest;
    "Debugger.restartFrame": Debugger.RestartFrameRequest;
    "Debugger.resume": Debugger.ResumeRequest;
    "Debugger.searchInContent": Debugger.SearchInContentRequest;
    "Debugger.setAsyncCallStackDepth": Debugger.SetAsyncCallStackDepthRequest;
    "Debugger.setBlackboxPatterns": Debugger.SetBlackboxPatternsRequest;
    "Debugger.setBlackboxedRanges": Debugger.SetBlackboxedRangesRequest;
    "Debugger.setBreakpoint": Debugger.SetBreakpointRequest;
    "Debugger.setInstrumentationBreakpoint": Debugger.SetInstrumentationBreakpointRequest;
    "Debugger.setBreakpointByUrl": Debugger.SetBreakpointByUrlRequest;
    "Debugger.setBreakpointOnFunctionCall": Debugger.SetBreakpointOnFunctionCallRequest;
    "Debugger.setBreakpointsActive": Debugger.SetBreakpointsActiveRequest;
    "Debugger.setPauseOnExceptions": Debugger.SetPauseOnExceptionsRequest;
    "Debugger.setReturnValue": Debugger.SetReturnValueRequest;
    "Debugger.setScriptSource": Debugger.SetScriptSourceRequest;
    "Debugger.setSkipAllPauses": Debugger.SetSkipAllPausesRequest;
    "Debugger.setVariableValue": Debugger.SetVariableValueRequest;
    "Debugger.stepInto": Debugger.StepIntoRequest;
    "Debugger.stepOut": Debugger.StepOutRequest;
    "Debugger.stepOver": Debugger.StepOverRequest;
    "HeapProfiler.addInspectedHeapObject": HeapProfiler.AddInspectedHeapObjectRequest;
    "HeapProfiler.collectGarbage": HeapProfiler.CollectGarbageRequest;
    "HeapProfiler.disable": HeapProfiler.DisableRequest;
    "HeapProfiler.enable": HeapProfiler.EnableRequest;
    "HeapProfiler.getHeapObjectId": HeapProfiler.GetHeapObjectIdRequest;
    "HeapProfiler.getObjectByHeapObjectId": HeapProfiler.GetObjectByHeapObjectIdRequest;
    "HeapProfiler.getSamplingProfile": HeapProfiler.GetSamplingProfileRequest;
    "HeapProfiler.startSampling": HeapProfiler.StartSamplingRequest;
    "HeapProfiler.startTrackingHeapObjects": HeapProfiler.StartTrackingHeapObjectsRequest;
    "HeapProfiler.stopSampling": HeapProfiler.StopSamplingRequest;
    "HeapProfiler.stopTrackingHeapObjects": HeapProfiler.StopTrackingHeapObjectsRequest;
    "HeapProfiler.takeHeapSnapshot": HeapProfiler.TakeHeapSnapshotRequest;
    "Network.setAcceptedEncodings": Network.SetAcceptedEncodingsRequest;
    "Network.clearAcceptedEncodingsOverride": Network.ClearAcceptedEncodingsOverrideRequest;
    "Network.canClearBrowserCache": Network.CanClearBrowserCacheRequest;
    "Network.canClearBrowserCookies": Network.CanClearBrowserCookiesRequest;
    "Network.canEmulateNetworkConditions": Network.CanEmulateNetworkConditionsRequest;
    "Network.clearBrowserCache": Network.ClearBrowserCacheRequest;
    "Network.clearBrowserCookies": Network.ClearBrowserCookiesRequest;
    "Network.continueInterceptedRequest": Network.ContinueInterceptedRequestRequest;
    "Network.deleteCookies": Network.DeleteCookiesRequest;
    "Network.disable": Network.DisableRequest;
    "Network.emulateNetworkConditions": Network.EmulateNetworkConditionsRequest;
    "Network.enable": Network.EnableRequest;
    "Network.getAllCookies": Network.GetAllCookiesRequest;
    "Network.getCertificate": Network.GetCertificateRequest;
    "Network.getCookies": Network.GetCookiesRequest;
    "Network.getResponseBody": Network.GetResponseBodyRequest;
    "Network.getRequestPostData": Network.GetRequestPostDataRequest;
    "Network.getResponseBodyForInterception": Network.GetResponseBodyForInterceptionRequest;
    "Network.takeResponseBodyForInterceptionAsStream": Network.TakeResponseBodyForInterceptionAsStreamRequest;
    "Network.replayXHR": Network.ReplayXHRRequest;
    "Network.searchInResponseBody": Network.SearchInResponseBodyRequest;
    "Network.setBlockedURLs": Network.SetBlockedURLsRequest;
    "Network.setBypassServiceWorker": Network.SetBypassServiceWorkerRequest;
    "Network.setCacheDisabled": Network.SetCacheDisabledRequest;
    "Network.setCookie": Network.SetCookieRequest;
    "Network.setCookies": Network.SetCookiesRequest;
    "Network.setExtraHTTPHeaders": Network.SetExtraHTTPHeadersRequest;
    "Network.setAttachDebugStack": Network.SetAttachDebugStackRequest;
    "Network.setRequestInterception": Network.SetRequestInterceptionRequest;
    "Network.setUserAgentOverride": Network.SetUserAgentOverrideRequest;
    "Network.getSecurityIsolationStatus": unknown;
    "Network.enableReportingApi": Network.EnableReportingApiRequest;
    "Network.loadNetworkResource": Network.LoadNetworkResourceRequest;
    "Profiler.disable": Profiler.DisableRequest;
    "Profiler.enable": Profiler.EnableRequest;
    "Profiler.getBestEffortCoverage": Profiler.GetBestEffortCoverageRequest;
    "Profiler.setSamplingInterval": Profiler.SetSamplingIntervalRequest;
    "Profiler.start": Profiler.StartRequest;
    "Profiler.startPreciseCoverage": Profiler.StartPreciseCoverageRequest;
    "Profiler.stop": Profiler.StopRequest;
    "Profiler.stopPreciseCoverage": Profiler.StopPreciseCoverageRequest;
    "Profiler.takePreciseCoverage": Profiler.TakePreciseCoverageRequest;
    "Runtime.awaitPromise": Runtime.AwaitPromiseRequest;
    "Runtime.callFunctionOn": Runtime.CallFunctionOnRequest;
    "Runtime.compileScript": Runtime.CompileScriptRequest;
    "Runtime.disable": Runtime.DisableRequest;
    "Runtime.discardConsoleEntries": Runtime.DiscardConsoleEntriesRequest;
    "Runtime.enable": Runtime.EnableRequest;
    "Runtime.evaluate": Runtime.EvaluateRequest;
    "Runtime.getIsolateId": Runtime.GetIsolateIdRequest;
    "Runtime.getHeapUsage": Runtime.GetHeapUsageRequest;
    "Runtime.getProperties": Runtime.GetPropertiesRequest;
    "Runtime.globalLexicalScopeNames": Runtime.GlobalLexicalScopeNamesRequest;
    "Runtime.queryObjects": Runtime.QueryObjectsRequest;
    "Runtime.releaseObject": Runtime.ReleaseObjectRequest;
    "Runtime.releaseObjectGroup": Runtime.ReleaseObjectGroupRequest;
    "Runtime.runIfWaitingForDebugger": Runtime.RunIfWaitingForDebuggerRequest;
    "Runtime.runScript": Runtime.RunScriptRequest;
    "Runtime.setAsyncCallStackDepth": Runtime.SetAsyncCallStackDepthRequest;
    "Runtime.setCustomObjectFormatterEnabled": Runtime.SetCustomObjectFormatterEnabledRequest;
    "Runtime.setMaxCallStackSizeToCapture": Runtime.SetMaxCallStackSizeToCaptureRequest;
    "Runtime.terminateExecution": Runtime.TerminateExecutionRequest;
    "Runtime.addBinding": Runtime.AddBindingRequest;
    "Runtime.removeBinding": Runtime.RemoveBindingRequest;
    "Runtime.getExceptionDetails": Runtime.GetExceptionDetailsRequest;
  };
  export type ResponseMap = {
    "Console.clearMessages": Console.ClearMessagesResponse;
    "Console.disable": Console.DisableResponse;
    "Console.enable": Console.EnableResponse;
    "Debugger.continueToLocation": Debugger.ContinueToLocationResponse;
    "Debugger.disable": Debugger.DisableResponse;
    "Debugger.enable": Debugger.EnableResponse;
    "Debugger.evaluateOnCallFrame": Debugger.EvaluateOnCallFrameResponse;
    "Debugger.getPossibleBreakpoints": Debugger.GetPossibleBreakpointsResponse;
    "Debugger.getScriptSource": Debugger.GetScriptSourceResponse;
    "Debugger.disassembleWasmModule": Debugger.DisassembleWasmModuleResponse;
    "Debugger.nextWasmDisassemblyChunk": Debugger.NextWasmDisassemblyChunkResponse;
    "Debugger.getWasmBytecode": Debugger.GetWasmBytecodeResponse;
    "Debugger.getStackTrace": Debugger.GetStackTraceResponse;
    "Debugger.pause": Debugger.PauseResponse;
    "Debugger.pauseOnAsyncCall": Debugger.PauseOnAsyncCallResponse;
    "Debugger.removeBreakpoint": Debugger.RemoveBreakpointResponse;
    "Debugger.restartFrame": Debugger.RestartFrameResponse;
    "Debugger.resume": Debugger.ResumeResponse;
    "Debugger.searchInContent": Debugger.SearchInContentResponse;
    "Debugger.setAsyncCallStackDepth": Debugger.SetAsyncCallStackDepthResponse;
    "Debugger.setBlackboxPatterns": Debugger.SetBlackboxPatternsResponse;
    "Debugger.setBlackboxedRanges": Debugger.SetBlackboxedRangesResponse;
    "Debugger.setBreakpoint": Debugger.SetBreakpointResponse;
    "Debugger.setInstrumentationBreakpoint": Debugger.SetInstrumentationBreakpointResponse;
    "Debugger.setBreakpointByUrl": Debugger.SetBreakpointByUrlResponse;
    "Debugger.setBreakpointOnFunctionCall": Debugger.SetBreakpointOnFunctionCallResponse;
    "Debugger.setBreakpointsActive": Debugger.SetBreakpointsActiveResponse;
    "Debugger.setPauseOnExceptions": Debugger.SetPauseOnExceptionsResponse;
    "Debugger.setReturnValue": Debugger.SetReturnValueResponse;
    "Debugger.setScriptSource": Debugger.SetScriptSourceResponse;
    "Debugger.setSkipAllPauses": Debugger.SetSkipAllPausesResponse;
    "Debugger.setVariableValue": Debugger.SetVariableValueResponse;
    "Debugger.stepInto": Debugger.StepIntoResponse;
    "Debugger.stepOut": Debugger.StepOutResponse;
    "Debugger.stepOver": Debugger.StepOverResponse;
    "HeapProfiler.addInspectedHeapObject": HeapProfiler.AddInspectedHeapObjectResponse;
    "HeapProfiler.collectGarbage": HeapProfiler.CollectGarbageResponse;
    "HeapProfiler.disable": HeapProfiler.DisableResponse;
    "HeapProfiler.enable": HeapProfiler.EnableResponse;
    "HeapProfiler.getHeapObjectId": HeapProfiler.GetHeapObjectIdResponse;
    "HeapProfiler.getObjectByHeapObjectId": HeapProfiler.GetObjectByHeapObjectIdResponse;
    "HeapProfiler.getSamplingProfile": HeapProfiler.GetSamplingProfileResponse;
    "HeapProfiler.startSampling": HeapProfiler.StartSamplingResponse;
    "HeapProfiler.startTrackingHeapObjects": HeapProfiler.StartTrackingHeapObjectsResponse;
    "HeapProfiler.stopSampling": HeapProfiler.StopSamplingResponse;
    "HeapProfiler.stopTrackingHeapObjects": HeapProfiler.StopTrackingHeapObjectsResponse;
    "HeapProfiler.takeHeapSnapshot": HeapProfiler.TakeHeapSnapshotResponse;
    "Network.setAcceptedEncodings": Network.SetAcceptedEncodingsResponse;
    "Network.clearAcceptedEncodingsOverride": Network.ClearAcceptedEncodingsOverrideResponse;
    "Network.canClearBrowserCache": Network.CanClearBrowserCacheResponse;
    "Network.canClearBrowserCookies": Network.CanClearBrowserCookiesResponse;
    "Network.canEmulateNetworkConditions": Network.CanEmulateNetworkConditionsResponse;
    "Network.clearBrowserCache": Network.ClearBrowserCacheResponse;
    "Network.clearBrowserCookies": Network.ClearBrowserCookiesResponse;
    "Network.continueInterceptedRequest": Network.ContinueInterceptedRequestResponse;
    "Network.deleteCookies": Network.DeleteCookiesResponse;
    "Network.disable": Network.DisableResponse;
    "Network.emulateNetworkConditions": Network.EmulateNetworkConditionsResponse;
    "Network.enable": Network.EnableResponse;
    "Network.getAllCookies": Network.GetAllCookiesResponse;
    "Network.getCertificate": Network.GetCertificateResponse;
    "Network.getCookies": Network.GetCookiesResponse;
    "Network.getResponseBody": Network.GetResponseBodyResponse;
    "Network.getRequestPostData": Network.GetRequestPostDataResponse;
    "Network.getResponseBodyForInterception": Network.GetResponseBodyForInterceptionResponse;
    "Network.takeResponseBodyForInterceptionAsStream": Network.TakeResponseBodyForInterceptionAsStreamResponse;
    "Network.replayXHR": Network.ReplayXHRResponse;
    "Network.searchInResponseBody": Network.SearchInResponseBodyResponse;
    "Network.setBlockedURLs": Network.SetBlockedURLsResponse;
    "Network.setBypassServiceWorker": Network.SetBypassServiceWorkerResponse;
    "Network.setCacheDisabled": Network.SetCacheDisabledResponse;
    "Network.setCookie": Network.SetCookieResponse;
    "Network.setCookies": Network.SetCookiesResponse;
    "Network.setExtraHTTPHeaders": Network.SetExtraHTTPHeadersResponse;
    "Network.setAttachDebugStack": Network.SetAttachDebugStackResponse;
    "Network.setRequestInterception": Network.SetRequestInterceptionResponse;
    "Network.setUserAgentOverride": Network.SetUserAgentOverrideResponse;
    "Network.getSecurityIsolationStatus": unknown;
    "Network.enableReportingApi": Network.EnableReportingApiResponse;
    "Network.loadNetworkResource": Network.LoadNetworkResourceResponse;
    "Profiler.disable": Profiler.DisableResponse;
    "Profiler.enable": Profiler.EnableResponse;
    "Profiler.getBestEffortCoverage": Profiler.GetBestEffortCoverageResponse;
    "Profiler.setSamplingInterval": Profiler.SetSamplingIntervalResponse;
    "Profiler.start": Profiler.StartResponse;
    "Profiler.startPreciseCoverage": Profiler.StartPreciseCoverageResponse;
    "Profiler.stop": Profiler.StopResponse;
    "Profiler.stopPreciseCoverage": Profiler.StopPreciseCoverageResponse;
    "Profiler.takePreciseCoverage": Profiler.TakePreciseCoverageResponse;
    "Runtime.awaitPromise": Runtime.AwaitPromiseResponse;
    "Runtime.callFunctionOn": Runtime.CallFunctionOnResponse;
    "Runtime.compileScript": Runtime.CompileScriptResponse;
    "Runtime.disable": Runtime.DisableResponse;
    "Runtime.discardConsoleEntries": Runtime.DiscardConsoleEntriesResponse;
    "Runtime.enable": Runtime.EnableResponse;
    "Runtime.evaluate": Runtime.EvaluateResponse;
    "Runtime.getIsolateId": Runtime.GetIsolateIdResponse;
    "Runtime.getHeapUsage": Runtime.GetHeapUsageResponse;
    "Runtime.getProperties": Runtime.GetPropertiesResponse;
    "Runtime.globalLexicalScopeNames": Runtime.GlobalLexicalScopeNamesResponse;
    "Runtime.queryObjects": Runtime.QueryObjectsResponse;
    "Runtime.releaseObject": Runtime.ReleaseObjectResponse;
    "Runtime.releaseObjectGroup": Runtime.ReleaseObjectGroupResponse;
    "Runtime.runIfWaitingForDebugger": Runtime.RunIfWaitingForDebuggerResponse;
    "Runtime.runScript": Runtime.RunScriptResponse;
    "Runtime.setAsyncCallStackDepth": Runtime.SetAsyncCallStackDepthResponse;
    "Runtime.setCustomObjectFormatterEnabled": Runtime.SetCustomObjectFormatterEnabledResponse;
    "Runtime.setMaxCallStackSizeToCapture": Runtime.SetMaxCallStackSizeToCaptureResponse;
    "Runtime.terminateExecution": Runtime.TerminateExecutionResponse;
    "Runtime.addBinding": Runtime.AddBindingResponse;
    "Runtime.removeBinding": Runtime.RemoveBindingResponse;
    "Runtime.getExceptionDetails": Runtime.GetExceptionDetailsResponse;
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
