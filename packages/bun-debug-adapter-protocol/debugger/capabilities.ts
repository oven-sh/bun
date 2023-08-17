import type { DAP } from "..";

const capabilities: DAP.Capabilities = {
  /**
   * The debug adapter supports the `configurationDone` request.
   * @see configurationDone
   */
  supportsConfigurationDoneRequest: true,

  /**
   * The debug adapter supports function breakpoints using the `setFunctionBreakpoints` request.
   * @see setFunctionBreakpoints
   */
  supportsFunctionBreakpoints: false,

  /**
   * The debug adapter supports conditional breakpoints.
   * @see setBreakpoints
   * @see setInstructionBreakpoints
   * @see setFunctionBreakpoints
   * @see setExceptionBreakpoints
   * @see setDataBreakpoints
   */
  supportsConditionalBreakpoints: false,

  /**
   * The debug adapter supports breakpoints that break execution after a specified number of hits.
   * @see setBreakpoints
   * @see setInstructionBreakpoints
   * @see setFunctionBreakpoints
   * @see setExceptionBreakpoints
   * @see setDataBreakpoints
   */
  supportsHitConditionalBreakpoints: false,

  /**
   * The debug adapter supports a (side effect free) `evaluate` request for data hovers.
   * @see evaluate
   */
  supportsEvaluateForHovers: true,

  /**
   * Available exception filter options for the `setExceptionBreakpoints` request.
   * @see setExceptionBreakpoints
   */
  exceptionBreakpointFilters: [
    {
      filter: "all",
      label: "Caught Exceptions",
      default: false,
      supportsCondition: true,
      description: "Breaks on all throw errors, even if they're caught later.",
      conditionDescription: `error.name == "CustomError"`,
    },
    {
      filter: "uncaught",
      label: "Uncaught Exceptions",
      default: false,
      supportsCondition: true,
      description: "Breaks only on errors or promise rejections that are not handled.",
      conditionDescription: `error.name == "CustomError"`,
    },
  ],

  /**
   * The debug adapter supports stepping back via the `stepBack` and `reverseContinue` requests.
   * @see stepBack
   * @see reverseContinue
   */
  supportsStepBack: false,

  /**
   * The debug adapter supports setting a variable to a value.
   * @see setVariable
   */
  supportsSetVariable: false,

  /**
   * The debug adapter supports restarting a frame.
   * @see restartFrame
   */
  supportsRestartFrame: false,

  /**
   * The debug adapter supports the `gotoTargets` request.
   * @see gotoTargets
   */
  supportsGotoTargetsRequest: false,

  /**
   * The debug adapter supports the `stepInTargets` request.
   * @see stepInTargets
   */
  supportsStepInTargetsRequest: false,

  /**
   * The debug adapter supports the `completions` request.
   * @see completions
   */
  supportsCompletionsRequest: false,

  /**
   * The set of characters that should trigger completion in a REPL.
   * If not specified, the UI should assume the `.` character.
   * @see completions
   */
  completionTriggerCharacters: [".", "[", '"', "'"],

  /**
   * The debug adapter supports the `modules` request.
   * @see modules
   */
  supportsModulesRequest: false,

  /**
   * The set of additional module information exposed by the debug adapter.
   * @see modules
   */
  additionalModuleColumns: [],

  /**
   * Checksum algorithms supported by the debug adapter.
   */
  supportedChecksumAlgorithms: [],

  /**
   * The debug adapter supports the `restart` request.
   * In this case a client should not implement `restart` by terminating
   * and relaunching the adapter but by calling the `restart` request.
   * @see restart
   */
  supportsRestartRequest: false,

  /**
   * The debug adapter supports `exceptionOptions` on the `setExceptionBreakpoints` request.
   * @see setExceptionBreakpoints
   */
  supportsExceptionOptions: false,

  /**
   * The debug adapter supports a `format` attribute on the `stackTrace`, `variables`, and `evaluate` requests.
   * @see stackTrace
   * @see variables
   * @see evaluate
   */
  supportsValueFormattingOptions: false,

  /**
   * The debug adapter supports the `exceptionInfo` request.
   * @see exceptionInfo
   */
  supportsExceptionInfoRequest: true,

  /**
   * The debug adapter supports the `terminateDebuggee` attribute on the `disconnect` request.
   * @see disconnect
   */
  supportTerminateDebuggee: true,

  /**
   * The debug adapter supports the `suspendDebuggee` attribute on the `disconnect` request.
   * @see disconnect
   */
  supportSuspendDebuggee: false,

  /**
   * The debug adapter supports the delayed loading of parts of the stack,
   * which requires that both the `startFrame` and `levels` arguments and
   * the `totalFrames` result of the `stackTrace` request are supported.
   * @see stackTrace
   */
  supportsDelayedStackTraceLoading: true,

  /**
   * The debug adapter supports the `loadedSources` request.
   * @see loadedSources
   */
  supportsLoadedSourcesRequest: true,

  /**
   * The debug adapter supports log points by interpreting the `logMessage` attribute of the `SourceBreakpoint`.
   * @see setBreakpoints
   */
  supportsLogPoints: false,

  /**
   * The debug adapter supports the `terminateThreads` request.
   * @see terminateThreads
   */
  supportsTerminateThreadsRequest: false,

  /**
   * The debug adapter supports the `setExpression` request.
   * @see setExpression
   */
  supportsSetExpression: false,

  /**
   * The debug adapter supports the `terminate` request.
   * @see terminate
   */
  supportsTerminateRequest: true,

  /**
   * The debug adapter supports data breakpoints.
   * @see setDataBreakpoints
   */
  supportsDataBreakpoints: false,

  /**
   * The debug adapter supports the `readMemory` request.
   * @see readMemory
   */
  supportsReadMemoryRequest: false,

  /**
   * The debug adapter supports the `writeMemory` request.
   * @see writeMemory
   */
  supportsWriteMemoryRequest: false,

  /**
   * The debug adapter supports the `disassemble` request.
   * @see disassemble
   */
  supportsDisassembleRequest: false,

  /**
   * The debug adapter supports the `cancel` request.
   * @see cancel
   */
  supportsCancelRequest: false,

  /**
   * The debug adapter supports the `breakpointLocations` request.
   * @see breakpointLocations
   */
  supportsBreakpointLocationsRequest: true,

  /**
   * The debug adapter supports the `clipboard` context value in the `evaluate` request.
   * @see evaluate
   */
  supportsClipboardContext: false,

  /**
   * The debug adapter supports stepping granularities (argument `granularity`) for the stepping requests.
   * @see stepIn
   */
  supportsSteppingGranularity: false,

  /**
   * The debug adapter supports adding breakpoints based on instruction references.
   * @see setInstructionBreakpoints
   */
  supportsInstructionBreakpoints: false,

  /**
   * The debug adapter supports `filterOptions` as an argument on the `setExceptionBreakpoints` request.
   * @see setExceptionBreakpoints
   */
  supportsExceptionFilterOptions: true,

  /**
   * The debug adapter supports the `singleThread` property on the execution requests
   * (`continue`, `next`, `stepIn`, `stepOut`, `reverseContinue`, `stepBack`).
   */
  supportsSingleThreadExecutionRequests: false,
};

export default capabilities;
