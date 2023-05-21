declare module "bun:jsc" {
  /**
   * This used to be called "describe" but it could be confused with the test runner.
   */
  export function jscDescribe(value: any): string;
  export function jscDescribeArray(args: any[]): string;
  export function gcAndSweep(): number;
  export function fullGC(): number;
  export function edenGC(): number;
  export function heapSize(): number;
  export function heapStats(): {
    heapSize: number;
    heapCapacity: number;
    extraMemorySize: number;
    objectCount: number;
    protectedObjectCount: number;
    globalObjectCount: number;
    protectedGlobalObjectCount: number;
    objectTypeCounts: Record<string, number>;
    protectedObjectTypeCounts: Record<string, number>;
  };
  export function memoryUsage(): {
    current: number;
    peak: number;
    currentCommit: number;
    peakCommit: number;
    pageFaults: number;
  };
  export function getRandomSeed(): number;
  export function setRandomSeed(value: number): void;
  export function isRope(input: string): boolean;
  export function callerSourceOrigin(): string;
  export function noFTL(func: Function): Function;
  export function noOSRExitFuzzing(func: Function): Function;
  export function optimizeNextInvocation(func: Function): void;
  export function numberOfDFGCompiles(func: Function): number;
  export function releaseWeakRefs(): void;
  export function totalCompileTime(func: Function): number;
  export function reoptimizationRetryCount(func: Function): number;
  export function drainMicrotasks(): void;

  /**
   * Run JavaScriptCore's sampling profiler for a particular function
   *
   * This is pretty low-level.
   *
   * Things to know:
   * - LLint means "Low Level Interpreter", which is the interpreter that runs before any JIT compilation
   * - Baseline is the first JIT compilation tier. It's the least optimized, but the fastest to compile
   * - DFG means "Data Flow Graph", which is the second JIT compilation tier. It has some optimizations, but is slower to compile
   * - FTL means "Faster Than Light", which is the third JIT compilation tier. It has the most optimizations, but is the slowest to compile
   */
  export function profile(
    callback: CallableFunction,
    sampleInterval?: number,
  ): {
    /**
     * A formatted summary of the top functions
     *
     * Example output:
     * ```js
     *
     * Sampling rate: 100.000000 microseconds. Total samples: 6858
     * Top functions as <numSamples  'functionName#hash:sourceID'>
     * 2948    '#<nil>:8'
     * 393    'visit#<nil>:8'
     * 263    'push#<nil>:8'
     * 164    'scan_ref_scoped#<nil>:8'
     * 164    'walk#<nil>:8'
     * 144    'pop#<nil>:8'
     * 107    'extract_candidates#<nil>:8'
     *  94    'get#<nil>:8'
     *  82    'Function#<nil>:4294967295'
     *  79    'set#<nil>:8'
     *  67    'forEach#<nil>:5'
     *  58    'collapse#<nil>:8'
     * ```
     */
    functions: string;
    /**
     * A formatted summary of the top bytecodes
     *
     * Example output:
     * ```js
     * Tier breakdown:
     * -----------------------------------
     * LLInt:                   106  (1.545640%)
     * Baseline:               2355  (34.339458%)
     * DFG:                    3290  (47.973170%)
     * FTL:                     833  (12.146398%)
     * js builtin:              132  (1.924759%)
     * Wasm:                      0  (0.000000%)
     * Host:                    111  (1.618548%)
     * RegExp:                   15  (0.218723%)
     * C/C++:                     0  (0.000000%)
     * Unknown Executable:      148  (2.158064%)
     *
     *
     * Hottest bytecodes as <numSamples   'functionName#hash:JITType:bytecodeIndex'>
     * 273    'visit#<nil>:DFG:bc#63'
     * 121    'walk#<nil>:DFG:bc#7'
     * 119    '#<nil>:Baseline:bc#1'
     * 82    'Function#<nil>:None:<nil>'
     * 66    '#<nil>:DFG:bc#11'
     * 65    '#<nil>:DFG:bc#33'
     * 58    '#<nil>:Baseline:bc#7'
     * 53    '#<nil>:Baseline:bc#23'
     * 50    'forEach#<nil>:DFG:bc#83'
     * 49    'pop#<nil>:FTL:bc#65'
     * 47    '#<nil>:DFG:bc#99'
     * 45    '#<nil>:DFG:bc#16'
     * 44    '#<nil>:DFG:bc#7'
     * 44    '#<nil>:Baseline:bc#30'
     * 44    'push#<nil>:FTL:bc#214'
     * 41    '#<nil>:DFG:bc#50'
     * 39    'get#<nil>:DFG:bc#27'
     * 39    '#<nil>:Baseline:bc#0'
     * 36    '#<nil>:DFG:bc#27'
     * 36    'Dictionary#<nil>:DFG:bc#41'
     * 36    'visit#<nil>:DFG:bc#81'
     * 36    'get#<nil>:FTL:bc#11'
     * 32    'push#<nil>:FTL:bc#49'
     * 31    '#<nil>:DFG:bc#76'
     * 31    '#<nil>:DFG:bc#10'
     * 31    '#<nil>:DFG:bc#73'
     * 29    'set#<nil>:DFG:bc#28'
     * 28    'in_boolean_context#<nil>:DFG:bc#104'
     * 28    '#<nil>:Baseline:<nil>'
     * 28    'regExpSplitFast#<nil>:None:<nil>'
     * 26    'visit#<nil>:DFG:bc#95'
     * 26    'pop#<nil>:FTL:bc#120'
     * 25    '#<nil>:DFG:bc#23'
     * 25    'push#<nil>:FTL:bc#152'
     * 24    'push#<nil>:FTL:bc#262'
     * 24    '#<nil>:FTL:bc#10'
     * 23    'is_identifier_char#<nil>:DFG:bc#22'
     * 23    'visit#<nil>:DFG:bc#22'
     * 22    '#<nil>:FTL:bc#27'
     * 22    'indexOf#<nil>:None:<nil>'
     * ```
     */
    bytecodes: string;

    /**
     * Stack traces of the top functions
     */
    stackTraces: string[];
  };

  /**
   * This returns objects which native code has explicitly protected from being
   * garbage collected
   *
   * By calling this function you create another reference to the object, which
   * will further prevent it from being garbage collected
   *
   * This function is mostly a debugging tool for bun itself.
   *
   * Warning: not all objects returned are supposed to be observable from JavaScript
   */
  export function getProtectedObjects(): any[];

  /**
   * Start a remote debugging socket server on the given port.
   *
   * This exposes JavaScriptCore's built-in debugging server.
   *
   * This is untested. May not be supported yet on macOS
   */
  export function startRemoteDebugger(host?: string, port?: number): void;

  /**
   * Run JavaScriptCore's sampling profiler
   */
  export function startSamplingProfiler(optionalDirectory?: string): void;
}
