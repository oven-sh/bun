/**
 * Low-level access to JavaScriptCore, the engine Bun runs JavaScript on:
 * garbage collection, heap and memory statistics, JIT controls, a sampling
 * profiler, and structured-clone serialization.
 *
 * Most of these functions exist for debugging Bun itself and for benchmarks.
 * The numbers they return describe JavaScriptCore internals.
 *
 * @example
 * ```ts
 * import { fullGC, heapStats } from "bun:jsc";
 *
 * fullGC();
 * console.log(heapStats().objectTypeCounts.Promise ?? 0, "live promises");
 * ```
 */
declare module "bun:jsc" {
  /**
   * Returns JavaScriptCore's debug description of a value: how the value is
   * represented (`Int32`, `Double`, `String`, `Object`, and so on) and, for
   * values on the heap, its address and its `Structure` (hidden class).
   *
   * Renamed from "describe" to avoid confusion with the test runner.
   *
   * @example
   * ```ts
   * import { jscDescribe } from "bun:jsc";
   *
   * jscDescribe(1); // "Int32: 1"
   * jscDescribe({ a: 1 }); // "Object: 0x... with butterfly (nil) (Structure 0x...:[..., Object, (1/2, 0/0){a:0}, NonArray, ...]), StructureID: ..."
   * ```
   */
  function jscDescribe(value: any): string;

  /**
   * Describes the storage behind an object's indexed elements: the address of
   * its "butterfly" (the out-of-line buffer JavaScriptCore keeps elements in),
   * the public `length`, and the "vector length" (the number of element slots
   * allocated, which can exceed `length`).
   *
   * Returns `"<not object>"` for primitives.
   *
   * @example
   * ```ts
   * import { jscDescribeArray } from "bun:jsc";
   *
   * jscDescribeArray([1, 2, 3]); // "<Butterfly: 0x...; public length: 3; vector length: 3>"
   * ```
   */
  function jscDescribeArray(array: any[]): string;

  /**
   * Runs a full garbage collection and then sweeps the heap, all synchronously,
   * so the memory of every unreachable object has been freed by the time this
   * returns. {@link fullGC} does the same collection but leaves the sweep to
   * happen lazily afterwards.
   *
   * @returns The size of the heap in bytes after the collection, as {@link heapSize} measures it
   */
  function gcAndSweep(): number;

  /**
   * Runs a full garbage collection synchronously: every object in the heap is
   * visited, and everything unreachable becomes garbage. Compare
   * {@link edenGC}, which only looks at recent allocations.
   *
   * The garbage's memory is reclaimed lazily as the heap is swept afterwards;
   * {@link gcAndSweep} also does the sweep before returning.
   *
   * Unlike `Bun.gc(true)`, this does not release the targets of `WeakRef`s
   * ({@link releaseWeakRefs}) and does not touch memory outside the
   * JavaScript heap.
   *
   * @returns The size of the heap in bytes after the collection, as {@link heapSize} measures it
   */
  function fullGC(): number;

  /**
   * Runs an eden (young generation) garbage collection synchronously.
   *
   * JavaScriptCore's collector is generational: an eden collection only
   * examines objects allocated since the previous collection, so it is much
   * cheaper than {@link fullGC}, but it cannot free an object that survived an
   * earlier collection.
   *
   * @returns The size of the heap in bytes after the most recent eden collection, as {@link heapSize} measures it
   */
  function edenGC(): number;

  /**
   * Returns the size of the JavaScript heap in bytes: the objects that
   * survived the most recent garbage collection, plus the memory they own
   * outside the heap (string contents, `ArrayBuffer` contents). Objects
   * allocated since the last collection are not included, so call
   * {@link fullGC} first for an up-to-date number.
   *
   * This is the `heapSize` field of {@link heapStats} without the rest of the
   * statistics. For the memory usage of the whole process, use
   * {@link memoryUsage}.
   */
  function heapSize(): number;

  /**
   * Returns statistics about the JavaScript heap, including a count of the
   * live objects of each type. See {@link HeapStats} for what each field
   * measures.
   *
   * Counting walks the whole heap, so this is much slower than
   * {@link heapSize}. To find out what is leaking, compare `objectTypeCounts`
   * from before and after the code you suspect, calling {@link fullGC} before
   * each snapshot so that garbage that has not been collected yet does not
   * show up in the difference.
   *
   * @example
   * ```ts
   * import { fullGC, heapStats } from "bun:jsc";
   *
   * fullGC();
   * const before = heapStats().objectTypeCounts;
   * await runSuspectedLeak();
   * fullGC();
   * const after = heapStats().objectTypeCounts;
   * for (const [type, count] of Object.entries(after)) {
   *   const delta = count - (before[type] ?? 0);
   *   if (delta > 0) console.log(type, "+" + delta);
   * }
   * ```
   */
  function heapStats(): HeapStats;

  /**
   * Returns memory statistics for the whole Bun process: resident set size,
   * committed memory, and page faults. See {@link MemoryUsage} for what each
   * field measures.
   *
   * Unlike {@link heapSize} and {@link heapStats}, this includes memory that is
   * not part of the JavaScript heap.
   */
  function memoryUsage(): MemoryUsage;

  /**
   * Returns the seed of the pseudo-random number generator behind
   * `Math.random()`. The seed is chosen at random when Bun starts; see
   * {@link setRandomSeed}.
   */
  function getRandomSeed(): number;

  /**
   * Reseeds the pseudo-random number generator behind `Math.random()`, making
   * the values it returns reproducible: after setting the same seed,
   * `Math.random()` returns the same sequence of values.
   *
   * The generator belongs to the current global object, so this does not affect
   * `node:vm` contexts, and it has no effect on `node:crypto` or Web Crypto.
   *
   * @param value The seed, converted to an unsigned 32-bit integer
   *
   * @example
   * ```ts
   * import { setRandomSeed } from "bun:jsc";
   *
   * setRandomSeed(42);
   * const a = Math.random();
   * setRandomSeed(42);
   * Math.random() === a; // true
   * ```
   */
  function setRandomSeed(value: number): void;

  /**
   * Returns whether a string is currently stored as a "rope".
   *
   * JavaScriptCore represents the result of string concatenation as a rope, a
   * tree pointing at the pieces, and only copies the pieces into one
   * contiguous buffer ("flattens" the rope) when something needs the
   * characters, such as a comparison, `charCodeAt`, using the string as a
   * property key, or passing it to native code. Once flattened, a string stays
   * flat.
   *
   * Returns `false` for anything that is not a string.
   *
   * @example
   * ```ts
   * import { isRope } from "bun:jsc";
   *
   * const s = "a".repeat(100) + "b".repeat(100);
   * isRope(s); // true
   * s.charCodeAt(0);
   * isRope(s); // false
   * ```
   */
  function isRope(input: string): boolean;

  /**
   * Returns the URL of the source file containing the code that called this
   * function, such as `"file:///home/me/app/index.ts"`. Code created with
   * `eval` or `new Function` reports the file that created it.
   *
   * Returns `null` when no JavaScript caller is on the stack, for example when
   * this function itself is passed as a callback to `Promise.prototype.then`.
   *
   * JavaScriptCore performs proper tail calls in strict mode code, which
   * includes every ES module, so a helper that does `return callerSourceOrigin()`
   * reports the file of the helper's caller rather than its own.
   */
  function callerSourceOrigin(): string | null;

  /**
   * Prevents a function from ever being compiled by the FTL JIT,
   * JavaScriptCore's highest optimization tier. The function can still reach
   * the baseline and DFG tiers. Use it to check whether a bug or a performance
   * difference is specific to FTL-compiled code.
   *
   * Only affects compilations that happen after the call, so call it before
   * `func` gets hot. Does nothing if `func` is not a JavaScript function.
   */
  function noFTL(func: (...args: any[]) => any): void;

  /**
   * Excludes a function from OSR exit fuzzing.
   *
   * OSR exit fuzzing is a JavaScriptCore testing mode, enabled with the
   * `BUN_JSC_useOSRExitFuzz=1` environment variable, in which optimized code
   * randomly bails out ("OSR exits") to the baseline tier in order to test
   * that bailing out is always correct. Has no effect unless fuzzing is
   * enabled, and does nothing if `func` is not a JavaScript function.
   */
  function noOSRExitFuzzing(func: (...args: any[]) => any): void;

  /**
   * Makes JavaScriptCore start optimizing a function (compiling it with the
   * DFG JIT) the next time it is called, instead of waiting for the function
   * to become hot on its own. Optimization happens on a background thread, so
   * the optimized code is installed shortly after that call; poll
   * {@link numberOfDFGCompiles} to find out when.
   *
   * Has no effect until the function has been called enough times to be
   * compiled by the baseline JIT, and does nothing if `func` is not a
   * JavaScript function.
   */
  function optimizeNextInvocation(func: (...args: any[]) => any): void;

  /**
   * Returns how many times a function has been optimized: `1` if the function
   * currently has DFG- or FTL-compiled code, plus one for each time its
   * optimized code has been thrown away ({@link reoptimizationRetryCount}).
   * Returns `0` while the function is still running in the interpreter or the
   * baseline JIT, and `1000000` when the JIT is disabled.
   *
   * @example
   * ```ts
   * import { numberOfDFGCompiles } from "bun:jsc";
   *
   * function add(a: number, b: number) {
   *   return a + b;
   * }
   *
   * // Run until the optimizing compiler has picked up `add`
   * while (numberOfDFGCompiles(add) === 0) add(1, 2);
   * ```
   */
  function numberOfDFGCompiles(func: (...args: any[]) => any): number;

  /**
   * Releases the targets of `WeakRef`s so that a garbage collection can
   * collect them immediately.
   *
   * As the JavaScript specification requires, creating a `WeakRef` or calling
   * its `deref()` keeps the target alive until the end of the current job (the
   * current synchronous run of script). That is why a `WeakRef` created in the
   * same script as a {@link fullGC} call still holds its target afterwards;
   * calling this first lets the collection clear it.
   *
   * @example
   * ```ts
   * import { fullGC, releaseWeakRefs } from "bun:jsc";
   *
   * let target: object | null = {};
   * const ref = new WeakRef(target);
   * target = null;
   *
   * fullGC();
   * ref.deref(); // still the object
   *
   * releaseWeakRefs();
   * fullGC();
   * ref.deref(); // undefined
   * ```
   */
  function releaseWeakRefs(): void;

  /**
   * Returns the total time in milliseconds this process has spent
   * JIT-compiling JavaScript, across the baseline, DFG, and FTL tiers.
   *
   * JavaScriptCore only records compile times when it is started with the
   * `BUN_JSC_reportTotalCompileTimes=1` environment variable; otherwise this
   * returns `0`.
   */
  function totalCompileTime(): number;

  /**
   * Returns how many times JavaScriptCore has thrown away a function's
   * optimized code because the assumptions it was compiled with turned out to
   * be wrong (for example, a function that was only ever called with integers
   * is called with a string), forcing the function to be optimized again. Each
   * retry doubles how long the function has to run before it is optimized
   * again, so a function with a high count is being deoptimized repeatedly.
   *
   * Returns `0` for functions that have not been compiled by the baseline JIT
   * yet.
   */
  function reoptimizationRetryCount(func: (...args: any[]) => any): number;

  /**
   * Runs every pending microtask right now: promise reactions,
   * `queueMicrotask()` callbacks, and `process.nextTick()` callbacks. Callbacks
   * that Bun's event loop has already queued, such as those of I/O that has
   * completed, run as well. Nothing is waited for, and timers do not fire.
   *
   * Microtasks normally run only after the current script or callback
   * finishes; this lets synchronous code observe their effects immediately.
   *
   * @example
   * ```ts
   * import { drainMicrotasks } from "bun:jsc";
   *
   * let resolved = false;
   * Promise.resolve().then(() => {
   *   resolved = true;
   * });
   * drainMicrotasks();
   * resolved; // true
   * ```
   */
  function drainMicrotasks(): void;

  /**
   * Serializes a JavaScript value into a binary representation that can be sent to another Bun instance.
   *
   * Internally, this uses the serialization format from WebKit/Safari.
   *
   * @param value The value to serialize, usually an object or array
   * @returns A SharedArrayBuffer that can be sent to another Bun instance
   */
  function serialize(value: any, options?: { binaryType?: "arraybuffer" }): SharedArrayBuffer;

  /**
   * Serializes a JavaScript value into a binary representation that can be sent to another Bun instance.
   *
   * Internally, this uses the serialization format from WebKit/Safari.
   *
   * @param value The value to serialize, usually an object or array
   * @returns A Buffer that can be sent to another Bun instance
   */
  function serialize(value: any, options?: { binaryType: "nodebuffer" }): Buffer;

  /**
   * Converts an ArrayBuffer or Buffer to a JavaScript value compatible with the HTML Structured Clone Algorithm.
   *
   * @param value The serialized value to convert, usually an ArrayBuffer or Buffer
   */
  function deserialize(value: ArrayBufferLike | NodeJS.TypedArray | Buffer): any;

  /**
   * Sets the time zone used by `Intl`, `Date`, and other date and time APIs.
   *
   * You can also set the time zone with the `TZ` environment variable, and read
   * the current one with `Intl.DateTimeFormat().resolvedOptions().timeZone`.
   *
   * @param timeZone The time zone to use, such as "America/Los_Angeles"
   * @returns The normalized time zone string
   */
  function setTimeZone(timeZone: string): string;

  /**
   * Statistics about the JavaScript heap, returned by {@link heapStats}.
   * Sizes are in bytes.
   *
   * `heapSize` and `objectCount` only count the objects that survived the most
   * recent garbage collection, while `objectTypeCounts` includes everything
   * currently allocated, so call {@link fullGC} before taking a snapshot you
   * intend to compare.
   */
  interface HeapStats {
    /**
     * Size of the objects that survived the most recent garbage collection,
     * plus `extraMemorySize`. The same number {@link heapSize} returns.
     */
    heapSize: number;
    /**
     * Memory the heap has reserved for holding objects, plus
     * `extraMemorySize`. At least `heapSize`; the difference is space that new
     * objects can be allocated into without growing the heap.
     */
    heapCapacity: number;
    /**
     * Memory owned by objects in the heap but allocated outside of it, such as
     * the contents of strings and `ArrayBuffer`s. Included in both `heapSize`
     * and `heapCapacity`.
     */
    extraMemorySize: number;
    /**
     * Number of cells that survived the most recent garbage collection. Every
     * garbage-collected allocation is a cell: objects, strings, functions, and
     * JavaScriptCore's internal structures alike.
     */
    objectCount: number;
    /**
     * Number of cells that native code has protected from being garbage
     * collected. {@link getProtectedObjects} returns them.
     */
    protectedObjectCount: number;
    /**
     * Number of global objects in the heap: one for the main script, plus one
     * for each `node:vm` context.
     */
    globalObjectCount: number;
    /**
     * How many of the global objects are protected by native code.
     */
    protectedGlobalObjectCount: number;
    /**
     * Number of live cells of each type, keyed by JavaScriptCore's name for the
     * type: JavaScript classes such as `Object`, `Array`, `Promise`, and
     * `Function`, engine-internal types such as `Structure` and
     * `FunctionExecutable`, and `string` for primitive strings. Ordered from
     * most to least common; types with no live instances are omitted.
     *
     * Unlike `objectCount`, this includes cells allocated since the last
     * garbage collection.
     */
    objectTypeCounts: Record<string, number>;
    /**
     * Like `objectTypeCounts`, but counting only the cells included in
     * `protectedObjectCount`.
     */
    protectedObjectTypeCounts: Record<string, number>;
  }

  /**
   * Memory statistics for the whole process, returned by {@link memoryUsage}.
   * Sizes are in bytes.
   */
  interface MemoryUsage {
    /**
     * Resident set size: the physical memory the process is using right now.
     * The same measurement as `process.memoryUsage().rss`.
     */
    current: number;
    /**
     * The largest resident set size the process has had.
     */
    peak: number;
    /**
     * On macOS and Linux, the memory currently committed by
     * [mimalloc](https://github.com/microsoft/mimalloc), the allocator Bun uses
     * for memory outside the JavaScript heap. On Windows, the process's commit
     * charge.
     */
    currentCommit: number;
    /**
     * The largest value `currentCommit` has had.
     */
    peakCommit: number;
    /**
     * On macOS and Linux, the number of major page faults (faults that had to
     * read from disk) the process has taken. On Windows, the total number of
     * page faults.
     */
    pageFaults: number;
  }

  /**
   * One sampled stack frame in a {@link SamplingProfileStackTraces} trace.
   */
  interface SamplingProfileStackFrame {
    /**
     * Identifies the source file; matches the `sourceID` of an entry in
     * {@link SamplingProfileStackTraces.sources}. `4294967295` for native
     * functions, which have no source.
     */
    sourceID: number;
    /**
     * The function's name, `""` for anonymous functions, or `"(module)"` for
     * a module's top-level code.
     */
    name: string;
    /**
     * Where in the function the sample landed, as the function's code hash,
     * the tier, and the bytecode index, for example `"#A4IKxq:Baseline:bc#78"`.
     * This is the same notation {@link SamplingProfile.bytecodes} uses.
     * `"#<nil>:None:<nil>"` for native functions.
     */
    location: string;
    /**
     * Path or URL of the source file (or the specifier of a built-in module,
     * such as `"node:events"`), mapped through its source map when it has
     * one. Absent for native functions.
     */
    sourceURL?: string;
    /**
     * 1-based line of the sampled location. `4294967295` when unknown, such as
     * for native functions.
     */
    line: number;
    /**
     * 1-based column of the sampled location. `4294967295` when unknown.
     */
    column: number;
    /**
     * The tier the function was running in when sampled: `"LLInt"`,
     * `"Baseline"`, `"DFG"`, or `"FTL"` for JavaScript functions, or one of the
     * other names from the tier breakdown in {@link SamplingProfile.bytecodes}
     * (native functions show up as `"Unknown Executable"`).
     */
    category: string;
    /**
     * `1` if the function is part of the JavaScript built into Bun
     * (JavaScriptCore's own builtins and Bun's built-in modules such as
     * `node:events`), `0` if it is yours.
     */
    flags: number;
    /**
     * Present when the function had been inlined into another function's
     * optimized code: describes the function it was inlined into and the
     * position in it.
     */
    inliner?: {
      name: string;
      location: string;
      line: number;
      column: number;
      category: string;
    };
  }

  /**
   * The raw samples collected by the sampling profiler, as
   * {@link SamplingProfile.stackTraces}.
   */
  interface SamplingProfileStackTraces {
    /**
     * How often the stack was sampled, in seconds (`0.001` for the default
     * interval of 1000 microseconds).
     */
    interval: number;
    /**
     * One entry per sample, in the order they were taken.
     */
    traces: Array<{
      /**
       * When the sample was taken, in seconds on a monotonic clock. Only the
       * differences between samples are meaningful.
       */
      timestamp: number;
      /**
       * The stack at the time of the sample, innermost frame first.
       */
      frames: SamplingProfileStackFrame[];
    }>;
    /**
     * The source files the sampled frames belong to. Native functions have no
     * source and are not listed.
     */
    sources: Array<{
      /**
       * The ID that {@link SamplingProfileStackFrame.sourceID} refers to.
       */
      sourceID: number;
      /**
       * Path or URL of the file, or the specifier of a built-in module such as
       * `"node:events"`. Absent for sources without one, such as code passed
       * to `eval`.
       */
      url?: string;
      /**
       * The file's `//# sourceURL=` directive, if it has one.
       */
      sourceURL?: string;
      /**
       * The file's `//# sourceMappingURL=` directive, if it has one.
       */
      sourceMappingURL?: string;
    }>;
  }

  /**
   * The result of {@link profile}: two human-readable reports plus the raw
   * samples they were computed from.
   */
  interface SamplingProfile {
    /**
     * A formatted summary of the functions that were most often at the top of
     * the stack when a sample was taken (that is, ranked by self time). Each
     * entry shows the number of samples, the function name, its code hash,
     * and the ID of its source file.
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
     * A formatted breakdown of the samples by execution tier, followed by the
     * individual bytecode locations that were sampled most often. Useful for
     * seeing which tier hot code is running in: time spent in `LLInt` or
     * `Baseline` means the code has not been optimized (yet).
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
     * The raw samples: the full stack captured at each sampling interval,
     * which is what `functions` and `bytecodes` are computed from. Use this to
     * build your own reports, such as a flame graph or inclusive timings.
     */
    stackTraces: SamplingProfileStackTraces;
  }

  /**
   * Runs JavaScriptCore's sampling profiler on a function and returns the profile.
   *
   * The profiler records the JavaScript stack every `sampleInterval`
   * microseconds while `callback` runs, then stops. The profile summarizes
   * where the samples landed; see {@link SamplingProfile}. If `callback`
   * throws, the profiler stops and the exception propagates.
   *
   * Tier names in the output:
   * - LLInt ("Low Level Interpreter") is the interpreter that runs before any JIT compilation
   * - Baseline is the first JIT compilation tier: the least optimized, but the fastest to compile
   * - DFG ("Data Flow Graph") is the second JIT compilation tier: some optimizations, but slower to compile
   * - FTL ("Faster Than Light") is the third JIT compilation tier: the most optimizations, but the slowest to compile
   *
   * @param callback The function to profile. It is called immediately, with `args`.
   * @param sampleInterval How often to sample the stack, in microseconds. Defaults to 1000 (once a millisecond).
   * @param args Arguments to call `callback` with
   * @returns The profile. If `callback` returns a promise, profiling continues until
   * that promise settles, and a promise of the profile is returned instead.
   *
   * @example
   * ```ts
   * import { profile } from "bun:jsc";
   *
   * const { functions } = profile(() => JSON.parse(JSON.stringify(bigObject)), 100);
   * console.log(functions);
   * ```
   */
  function profile<T extends (...args: any[]) => any>(
    callback: T,
    sampleInterval?: number,
    ...args: Parameters<T>
  ): ReturnType<T> extends Promise<infer U> ? Promise<SamplingProfile> : SamplingProfile;

  /**
   * Returns objects that native code has explicitly protected from being
   * garbage collected.
   *
   * Calling this function creates another reference to each object, which
   * further prevents it from being garbage collected.
   *
   * This is mostly a debugging tool for Bun itself.
   *
   * Warning: not all of the returned objects are supposed to be observable from JavaScript.
   */
  function getProtectedObjects(): any[];

  /**
   * Starts a remote debugging socket server on the given port.
   *
   * This exposes JavaScriptCore's built-in debugging server. It is separate
   * from Bun's debugger (`bun --inspect`).
   *
   * This is untested and may not be supported on macOS.
   *
   * @param host The address to listen on. Defaults to `"127.0.0.1"`.
   * @param port The port to listen on. Defaults to `9230`.
   * @throws {Error} If the server cannot listen, for example because the port is in use
   */
  function startRemoteDebugger(host?: string, port?: number): void;

  /**
   * Starts JavaScriptCore's sampling profiler and leaves it running for the
   * rest of the process. To profile one function and get the result back as a
   * value, use {@link profile} instead.
   *
   * @param optionalDirectory A directory to write a text report of the hottest
   * functions and bytecodes into when the process (or the worker that called
   * this) exits. Created if it does not exist.
   * @param sampleInterval How often to sample the stack, in microseconds. Defaults to 1000 (once a millisecond).
   */
  function startSamplingProfiler(optionalDirectory?: string, sampleInterval?: number): void;

  /**
   * Non-recursively estimates the memory usage of an object, excluding the memory usage of
   * properties or other objects it references. For more accurate per-object
   * memory usage, use {@link Bun.generateHeapSnapshot}.
   *
   * The estimate is best-effort. When it's wrong, the memory may be
   * non-contiguous (such as a large array).
   *
   * Passing a primitive type that isn't heap allocated returns 0.
   */
  function estimateShallowMemoryUsageOf(value: object | CallableFunction | bigint | symbol | string): number;
}
