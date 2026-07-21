// Hardcoded module "node:test"
// This follows the Node.js API as described in: https://nodejs.org/api/test.html
//
// Top-level tests and suites are scheduled through bun:test (Bun.jest), while
// subtests created inside a running test are executed inline by this module so
// that Node's TestContext semantics (subtests, hooks, plan, mock tracker,
// getTestContext) are observable without a separate runner process.

const { jest } = Bun;
const { kEmptyObject, throwNotImplemented } = require("internal/shared");
const {
  validateBoolean,
  validateInteger,
  validateObject,
  validateNumber,
  validateFunction,
  validateString,
  validateArray,
  validateAbortSignal,
  validateUint32,
  validateOneOf,
} = require("internal/validators");

const kDefaultName = "<anonymous>";
const kRootName = "<root>";
const kDefaultFunction = () => {};
// The runner's own timers must keep working while `mock.timers` replaces the
// globals, so capture them at module load like Node's runner does.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const kDefaultOptions = kEmptyObject;
// Matches Node's internal/timers TIMEOUT_MAX.
const kTimeoutMax = 2 ** 31 - 1;
// Matches bun:test's default per-test timeout.
const kBunTestDefaultTimeoutMs = 5_000;
const kJoinSeparator = " > ";

// -----------------------------------------------------------------------------
// run()
//
// Port of Node.js lib/internal/test_runner/{runner,tests_stream}.js (v26.3.0).
// Files run in child processes (node's isolation:'process'); the child is spawned
// with kRunChildEnv set, which makes this module stream one JSON event per line
// on stdout. Unmarked stdout/stderr lines become test:stdout/test:stderr, the
// same split node makes around its V8-serializer framing.
// -----------------------------------------------------------------------------

// node's own tests branch on NODE_TEST_CONTEXT to tell the parent from the
// spawned child, so use node's variable and value rather than a bun-specific one.
const kRunChildEnv = "NODE_TEST_CONTEXT";
const kRunChildEnvValue = "child-v8";
const kRunEventPrefix = "\0bun:test:run\0";

// Created lazily on the first run() call so the common test()/describe()
// path never loads node:stream.
type TestsStream = InstanceType<ReturnType<typeof getTestsStreamClass>>;
let TestsStreamClass: ReturnType<typeof getTestsStreamClass> | undefined;

function getTestsStreamClass() {
  const { Readable } = require("node:stream");
  return class TestsStream extends (Readable as typeof import("node:stream").Readable) {
    #buffer;
    #canPush = true;

    constructor() {
      super({ objectMode: true, highWaterMark: Number.MAX_SAFE_INTEGER });
      // $createFIFO cannot appear in a class-field initializer: the builtin
      // bundler mis-emits the intrinsic there.
      this.#buffer = $createFIFO();
    }

    _read() {
      this.#canPush = true;
      while (!this.#buffer.isEmpty()) {
        const obj = this.#buffer.shift();
        if (!this.#tryPush(obj)) return;
      }
    }

    #tryPush(message: unknown) {
      if (this.#canPush) {
        this.#canPush = this.push(message);
      } else {
        this.#buffer.push(message);
      }
      return this.#canPush;
    }

    emitMessage(type: string, data?: unknown) {
      this.emit(type, data);
      this.#tryPush({ __proto__: null, type, data });
    }

    endStream() {
      this.#tryPush(null);
    }
  };
}

function createTestsStream(): TestsStream {
  TestsStreamClass ??= getTestsStreamClass();
  return new TestsStreamClass();
}

function validateStringArray(value: unknown, name: string) {
  validateArray(value, name);
  for (let i = 0; i < (value as unknown[]).length; i++) {
    validateString((value as unknown[])[i], `${name}[${i}]`);
  }
}

// node canonicalizes tag filters to lower case and rejects empty strings
// (lib/internal/test_runner/tag_filter.js).
function validateAndCanonicalizeTagFilter(value: unknown, name: string) {
  validateString(value, name);
  if ((value as string).length === 0) {
    throw $ERR_INVALID_ARG_VALUE(name, value, "must not be empty");
  }
  return (value as string).toLowerCase();
}

function toRegExpPatterns(value: unknown, name: string) {
  const patterns = $isArray(value) ? value : [value];
  return patterns.map((entry: unknown, i: number) => {
    if ($isRegExpObject(entry)) return entry;
    if (typeof entry === "string") return convertStringToRegExp(entry, `${name}[${i}]`);
    throw $ERR_INVALID_ARG_TYPE(`${name}[${i}]`, ["string", "RegExp"], entry);
  });
}

// node's utils.js convertStringToRegExp: a "/pattern/flags" string becomes that
// RegExp, anything else is matched literally.
function convertStringToRegExp(str: string, name: string) {
  const match = str.match(/^\/(.*)\/([a-z]*)$/);
  const pattern = match?.[1] ?? str;
  const flags = match?.[2] ?? "";
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw $ERR_INVALID_ARG_VALUE(name, str, `is an invalid regular expression: ${(err as Error).message}`);
  }
}

// node's emitExperimentalWarning is one-shot per feature process-wide, so
// test({ tags }) and run({ testTagFilters }) share this flag.
let tagsExperimentalWarningEmitted = false;
function emitTagsExperimentalWarning() {
  if (tagsExperimentalWarningEmitted) return;
  tagsExperimentalWarningEmitted = true;
  process.emitWarning("Test tags is an experimental feature and might change at any time", "ExperimentalWarning");
}

function validateRunOptions(options: Record<string, unknown>) {
  validateObject(options, "options");

  let { testNamePatterns, testSkipPatterns, testTagFilters, shard } = options as Record<string, any>;
  const {
    files,
    forceExit,
    isolation = "process",
    watch,
    setup,
    globalSetupPath,
    only,
    globPatterns,
    coverage = false,
    lineCoverage = 0,
    branchCoverage = 0,
    functionCoverage = 0,
    execArgv = [],
    argv = [],
    cwd = process.cwd(),
    env,
  } = options as Record<string, any>;

  // Order mirrors node's runner.js:731-909 — the errors are observable.
  if (files != null) validateArray(files, "options.files");
  if (watch != null) validateBoolean(watch, "options.watch");
  if (forceExit != null) {
    validateBoolean(forceExit, "options.forceExit");
    if (forceExit && watch) {
      throw $ERR_INVALID_ARG_VALUE("options.forceExit", watch, "is not supported with watch mode");
    }
  }
  if (only != null) validateBoolean(only, "options.only");
  if (globPatterns != null) validateArray(globPatterns, "options.globPatterns");
  validateString(cwd, "options.cwd");
  if (globPatterns?.length > 0 && files?.length > 0) {
    throw $ERR_INVALID_ARG_VALUE(
      "options.globPatterns",
      globPatterns,
      "is not supported when specifying 'options.files'",
    );
  }
  if (shard != null) {
    validateObject(shard, "options.shard");
    shard = { __proto__: null, index: shard.index, total: shard.total };
    validateInteger(shard.total, "options.shard.total", 1);
    validateInteger(shard.index, "options.shard.index", 1, shard.total);
    if (watch) {
      throw $ERR_INVALID_ARG_VALUE("options.shard", watch, "shards not supported with watch mode");
    }
  }
  if (setup != null) validateFunction(setup, "options.setup");
  if (testNamePatterns != null) testNamePatterns = toRegExpPatterns(testNamePatterns, "options.testNamePatterns");
  if (testSkipPatterns != null) testSkipPatterns = toRegExpPatterns(testSkipPatterns, "options.testSkipPatterns");

  let testTagFilterExpressions = null;
  if (testTagFilters != null) {
    if (!$isArray(testTagFilters)) testTagFilters = [testTagFilters];
    if (testTagFilters.length === 0) {
      testTagFilters = null;
    } else {
      emitTagsExperimentalWarning();
      testTagFilters = testTagFilters.map((value: unknown, i: number) =>
        validateAndCanonicalizeTagFilter(value, `options.testTagFilters[${i}]`),
      );
      testTagFilterExpressions = testTagFilters;
    }
  }

  validateOneOf(isolation, "options.isolation", ["process", "none"]);
  validateBoolean(coverage, "options.coverage");
  validateInteger(lineCoverage, "options.lineCoverage", 0, 100);
  validateInteger(branchCoverage, "options.branchCoverage", 0, 100);
  validateInteger(functionCoverage, "options.functionCoverage", 0, 100);
  validateStringArray(argv, "options.argv");
  validateStringArray(execArgv, "options.execArgv");
  if (globalSetupPath != null) validateString(globalSetupPath, "options.globalSetupPath");
  if (env != null) {
    validateObject(env, "options.env");
    if (isolation === "none") {
      throw $ERR_INVALID_ARG_VALUE("options.env", env, "is not supported with isolation='none'");
    }
  }
  // Node validates these via the root Test constructor, not inline here;
  // the observable error is the same synchronous throw.
  const { concurrency, timeout, signal } = options as Record<string, any>;
  if (signal !== undefined) validateAbortSignal(signal, "options.signal");
  if (timeout != null && timeout !== Infinity) validateNumber(timeout, "options.timeout", 0, kTimeoutMax);
  if (concurrency != null && typeof concurrency !== "boolean") {
    if (typeof concurrency === "number") validateUint32(concurrency, "options.concurrency", true);
    else throw $ERR_INVALID_ARG_TYPE("options.concurrency", ["boolean", "number"], concurrency);
  }

  return {
    files,
    setup,
    cwd,
    env,
    argv,
    execArgv,
    isolation,
    watch,
    coverage,
    shard,
    globPatterns,
    globalSetupPath,
    only,
    testNamePatterns,
    testSkipPatterns,
    testTagFilterExpressions,
    concurrency,
    timeout,
    signal,
  };
}

function run(options: Record<string, unknown> = kEmptyObject) {
  const opts = validateRunOptions(options);
  const reporter = createTestsStream();

  // A test file that calls run() on itself would otherwise fork (or, with
  // isolation 'none', import) forever; node skips the files instead.
  if (runChildReporterEnabled || inProcessRunActive) {
    process.emitWarning("node:test run() is being called recursively within a test file. skipping running files.");
    reporter.endStream();
    return reporter;
  }

  // Options whose semantics we cannot honor yet must fail loudly rather than be
  // silently ignored. testTagFilters is the deliberate exception: validated for
  // node's error contract but not yet forwarded, pending the native reporter hook.
  if (opts.watch) throwNotImplemented("run({ watch: true })", 5090, "Use `bun:test --watch` in the interim.");
  if (opts.coverage) throwNotImplemented("run({ coverage: true })", 5090, "Use `bun:test --coverage` in the interim.");
  if (opts.shard) throwNotImplemented("run({ shard })", 5090);
  if (opts.globalSetupPath != null) throwNotImplemented("run({ globalSetupPath })", 5090);
  if (opts.only) throwNotImplemented("run({ only: true })", 5090);
  if (opts.testNamePatterns != null) throwNotImplemented("run({ testNamePatterns })", 5090);
  if (opts.testSkipPatterns != null) throwNotImplemented("run({ testSkipPatterns })", 5090);

  if (opts.isolation === "none") {
    // Set synchronously so an overlapping run() hits the recursion guard
    // instead of sharing the queue and sink.
    inProcessRunActive = true;
    runFilesInProcess(opts, reporter);
  } else {
    runFiles(opts, reporter);
  }
  return reporter;
}

// node's default discovery pattern (utils.js:71-77). Split into two globs:
// Bun.Glob mis-parses `test/**/*` nested inside a brace group.
const kDefaultRunPatterns = ["**/{test,test-*,*[._-]test}.{js,mjs,cjs}", "**/test/**/*.{js,mjs,cjs}"];

function discoverRunFiles(opts: ReturnType<typeof validateRunOptions>): string[] {
  const path = require("node:path");
  const cwd = opts.cwd as string;
  const files = opts.files as string[] | undefined;
  // An explicit files array wins even when empty: node runs nothing for [].
  if (files !== undefined) {
    return files.map(file => path.resolve(cwd, file));
  }
  const patterns = (opts.globPatterns as string[] | undefined)?.length
    ? (opts.globPatterns as string[])
    : kDefaultRunPatterns;
  const results = new Set<string>();
  for (const pattern of patterns) {
    for (const match of new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true })) {
      if (match.split("/").includes("node_modules") || match.split(path.sep).includes("node_modules")) {
        continue;
      }
      results.add(path.resolve(cwd, match));
    }
  }
  return Array.from(results).sort();
}

function makeRunCounts() {
  return {
    __proto__: null,
    tests: 0,
    failed: 0,
    passed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    topLevel: 0,
    suites: 0,
  } as unknown as Record<string, number>;
}

function addRunCounts(into: Record<string, number>, from: Record<string, number>) {
  for (const key of Object.keys(from)) into[key] += from[key];
}

function emitRunDiagnostics(reporter: TestsStream, counts: Record<string, number>, durationMs: number) {
  reporter.emitMessage("test:diagnostic", { __proto__: null, nesting: 0, message: `tests ${counts.tests}` });
  reporter.emitMessage("test:diagnostic", { __proto__: null, nesting: 0, message: `suites ${counts.suites}` });
  reporter.emitMessage("test:diagnostic", { __proto__: null, nesting: 0, message: `pass ${counts.passed}` });
  reporter.emitMessage("test:diagnostic", { __proto__: null, nesting: 0, message: `fail ${counts.failed}` });
  reporter.emitMessage("test:diagnostic", { __proto__: null, nesting: 0, message: `cancelled ${counts.cancelled}` });
  reporter.emitMessage("test:diagnostic", { __proto__: null, nesting: 0, message: `skipped ${counts.skipped}` });
  reporter.emitMessage("test:diagnostic", { __proto__: null, nesting: 0, message: `todo ${counts.todo}` });
  reporter.emitMessage("test:diagnostic", { __proto__: null, nesting: 0, message: `duration_ms ${durationMs}` });
}

// Per-run bookkeeping for SIGINT/SIGTERM: kept as a closure local so two
// overlapping run() calls cannot clobber each other's child/interrupt state.
type RunInterruptState = {
  interrupted: boolean;
  childProc: { kill: () => void } | null;
  fileNode: Record<string, unknown> | null;
};

// Runs each file in its own `bun test` child and republishes the child's events
// on the parent's stream, then emits the run-level plan/diagnostics/summary.
async function runFiles(opts: ReturnType<typeof validateRunOptions>, reporter: TestsStream) {
  const started = performance.now();
  const counts = makeRunCounts();
  const state: RunInterruptState = { interrupted: false, childProc: null, fileNode: null };

  // run() returns the stream before any file starts, and callers attach their
  // listeners synchronously on the returned stream. Yield first so the earliest
  // events (the file node's enqueue/dequeue) are not emitted into no listeners.
  await Promise.resolve();

  try {
    if (typeof opts.setup === "function") await opts.setup(reporter);

    // Explicit files keep their spelling: the per-file test is named by the
    // path as passed (node's runner), while discovery yields absolute paths.
    const files = opts.files !== undefined ? (opts.files as string[]) : discoverRunFiles(opts);
    const onInterrupt = () => {
      state.interrupted = true;
      state.childProc?.kill();
    };
    const signal = opts.signal as AbortSignal | undefined;
    if (signal?.aborted) onInterrupt();
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);
    signal?.addEventListener("abort", onInterrupt, { once: true });
    try {
      for (let i = 0; i < files.length; i++) {
        if (state.interrupted) break;
        await runOneFile(files[i], opts, reporter, counts, state);
      }
    } finally {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      signal?.removeEventListener("abort", onInterrupt);
    }

    if (state.interrupted) {
      // node reports the file-level tests that were still running.
      counts.failed++;
      reporter.emitMessage("test:interrupted", {
        __proto__: null,
        nesting: 0,
        tests: state.fileNode !== null ? [state.fileNode] : [],
      });
    }

    const { topLevel } = counts;
    if (topLevel > 0) {
      reporter.emitMessage("test:plan", { __proto__: null, nesting: 0, count: topLevel });
    }
    const durationMs = roundDurationMs(performance.now() - started);
    emitRunDiagnostics(reporter, counts, durationMs);
    reporter.emitMessage("test:summary", {
      __proto__: null,
      success: counts.failed === 0 && counts.cancelled === 0,
      counts,
      duration_ms: durationMs,
      file: undefined,
    });
  } catch (err) {
    reporter.destroy(err as Error);
    return;
  }
  reporter.endStream();
}

async function runOneFile(
  file: string,
  opts: ReturnType<typeof validateRunOptions>,
  reporter: TestsStream,
  counts: Record<string, number>,
  state: RunInterruptState,
) {
  const path = require("node:path");
  const absolute = path.resolve(opts.cwd as string, file);
  // Node's getRunArgs builds [...execArgv, path, ...argv] so runtime flags land
  // in the child's process.execArgv; bun's CLI likewise takes runtime flags
  // before the `test` keyword and user args after the path.
  const args = [process.execPath, ...(opts.execArgv as string[]), "test", absolute, ...(opts.argv as string[])];
  const fileStarted = performance.now();
  const fileCounts = makeRunCounts();

  // Under process isolation node models the file itself as a top-level test,
  // named by the path as it was passed in and located at 1:1.
  const fileNode = {
    nesting: 0,
    name: file,
    type: "test",
    testId: 1,
    parentId: 0,
    tags: [],
    line: 1,
    column: 1,
    file: absolute,
  };
  reporter.emitMessage("test:enqueue", { __proto__: null, ...fileNode });
  reporter.emitMessage("test:dequeue", { __proto__: null, ...fileNode });

  const proc = Bun.spawn({
    cmd: args,
    cwd: opts.cwd as string,
    env: { ...(opts.env ?? process.env), BUN_TEST_DRAIN_EVENT_LOOP: "1", [kRunChildEnv]: kRunChildEnvValue },
    stdout: "pipe",
    stderr: "pipe",
  });
  state.childProc = proc;
  state.fileNode = fileNode;

  let stderrText = "";
  const drainStderr = (async () => {
    stderrText = await new Response(proc.stderr).text();
    for (const line of stderrText.split("\n")) {
      if (line.length > 0)
        reporter.emitMessage("test:stderr", { __proto__: null, file: absolute, message: line + "\n" });
    }
  })();

  const stdout = await new Response(proc.stdout).text();
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    // bun:test's own reporter can leave an unterminated line, so the marker is
    // not always at column 0; take everything from the marker on.
    const marker = line.indexOf(kRunEventPrefix);
    if (marker === -1) {
      reporter.emitMessage("test:stdout", { __proto__: null, file: absolute, message: line + "\n" });
      continue;
    }
    if (marker > 0) {
      const before = line.slice(0, marker).trimEnd();
      if (before.length > 0) {
        reporter.emitMessage("test:stdout", { __proto__: null, file: absolute, message: before + "\n" });
      }
    }
    let event;
    try {
      event = JSON.parse(line.slice(marker + kRunEventPrefix.length));
    } catch {
      continue;
    }
    // node's parent swallows each child's root plan and emits one run-level
    // plan at the end (runner.js #skipReporting + Test.postRun).
    if (event.type === "test:plan" && event.data?.nesting === 0) continue;
    republishChildEvent(event, absolute, reporter, fileCounts);
  }

  await drainStderr;
  const exitCode = await proc.exited;
  state.childProc = null;
  if (state.interrupted) {
    // The interrupted file's verdict is replaced by runFiles' test:interrupted
    // report; suppress the synthesized failure and per-file summary so their
    // fileCounts bumps are not merged without a matching event.
    addRunCounts(counts, fileCounts);
    return;
  }
  state.fileNode = null;

  // Two failure shapes: the file died before reporting anything (top-level
  // throw — node emits a file-level test:fail and no per-file summary), or its
  // tests failed (covered by the children's events; completes `subtestsFailed`).
  const fileFailed = exitCode !== 0 && fileCounts.failed === 0 && fileCounts.cancelled === 0;
  const subtestsFailed = fileCounts.failed > 0 || fileCounts.cancelled > 0;
  const fileDuration = roundDurationMs(performance.now() - fileStarted);
  let error: Error | undefined;

  if (subtestsFailed) {
    const n = fileCounts.failed + fileCounts.cancelled;
    error = makeTestFailure(`${n} subtest${n === 1 ? "" : "s"} failed`, "subtestsFailed");
  }

  if (!fileFailed) {
    reporter.emitMessage("test:summary", {
      __proto__: null,
      success: fileCounts.failed === 0 && fileCounts.cancelled === 0,
      counts: fileCounts,
      duration_ms: fileDuration,
      file: absolute,
    });
  } else {
    error = makeTestFailure(stderrText.trim() || `Test file failed with exit code ${exitCode}`, "testCodeFailure");
    fileCounts.tests++;
    fileCounts.failed++;
    fileCounts.topLevel++;
  }

  // node emits the file node's completion before its verdict, and a failed
  // completion carries the error too.
  reporter.emitMessage("test:complete", {
    __proto__: null,
    ...fileNode,
    type: undefined,
    testNumber: 1,
    details: {
      __proto__: null,
      duration_ms: fileDuration,
      type: "test",
      passed: !fileFailed && !subtestsFailed,
      error,
    },
  });
  if (fileFailed) {
    reporter.emitMessage("test:fail", {
      __proto__: null,
      ...fileNode,
      type: undefined,
      testNumber: 1,
      details: { __proto__: null, duration_ms: fileDuration, type: "test", error },
    });
  }
  addRunCounts(counts, fileCounts);
}

function republishChildEvent(
  event: { type: string; data: any },
  file: string,
  reporter: TestsStream,
  counts: Record<string, number>,
) {
  const { type, data } = event;
  Object.setPrototypeOf(data, null);
  data.file = file;
  const isVerdict = type === "test:pass" || type === "test:fail";
  if (isVerdict || type === "test:complete") {
    const isSuite = data.type === "suite";
    if (isVerdict) {
      // node's parent renumbers top-level entries across files (runner.js).
      if (data.nesting === 0) {
        counts.topLevel++;
        data.testNumber = counts.topLevel;
      }
      // node counts a suite in `suites` and stops there: a skipped or todo
      // suite never lands in skipped/todo/passed/tests (countCompletedTest).
      if (isSuite) counts.suites++;
      else {
        counts.tests++;
        const failureType = data.error?.failureType;
        // node's kCanceledTests (runner.js): these failure kinds count as
        // cancelled, not failed.
        const wasCancelled =
          failureType === "testTimeoutFailure" || failureType === "cancelledByParent" || failureType === "testAborted";
        if (data.skip !== undefined) counts.skipped++;
        else if (data.todo !== undefined) counts.todo++;
        else if (type === "test:pass") counts.passed++;
        else if (wasCancelled) counts.cancelled++;
        else counts.failed++;
      }
    }
    // node carries the node kind on `details`, not on the event itself.
    const detailType = isSuite ? "suite" : "test";
    const serialized = data.error;
    let error;
    if (serialized !== undefined) {
      if (Error.isError(serialized)) {
        error = serialized;
      } else {
        const { message, stack, code, failureType, name, cause } = serialized;
        error = new Error(message);
        error.stack = stack;
        if (name !== undefined && name !== "Error") error.name = name;
        if (code !== undefined) (error as any).code = code;
        if (failureType !== undefined) (error as any).failureType = failureType;
        if (cause !== undefined) {
          const {
            name: causeName,
            generatedMessage: causeGeneratedMessage,
            code: causeCode,
            actual: causeActual,
            expected: causeExpected,
            operator: causeOperator,
            diff: causeDiff,
          } = cause;
          const rebuilt = new Error(cause.message) as Record<string, unknown> & Error;
          rebuilt.stack = cause.stack;
          if (causeName !== undefined && causeName !== "Error") rebuilt.name = causeName;
          // Enumerable-property order mirrors node's AssertionError inspect.
          if (causeGeneratedMessage !== undefined) rebuilt.generatedMessage = causeGeneratedMessage;
          if (causeCode !== undefined) rebuilt.code = causeCode;
          if (causeActual !== undefined) rebuilt.actual = causeActual;
          if (causeExpected !== undefined) rebuilt.expected = causeExpected;
          if (causeOperator !== undefined) rebuilt.operator = causeOperator;
          if (causeDiff !== undefined) rebuilt.diff = causeDiff;
          (error as { cause?: unknown }).cause = rebuilt;
        }
      }
    }
    data.details = { __proto__: null, duration_ms: data.duration_ms, type: detailType, error };
    if (type === "test:complete") data.details.passed = data.passed;
    delete data.error;
    delete data.duration_ms;
    delete data.type;
    delete data.passed;
  }
  reporter.emitMessage(type, data);
}

// Child side: with kRunChildEnv set, stream one JSON event per line so the
// spawning parent can rebuild node's event stream. Exact-value so a foreign
// runner's NODE_TEST_CONTEXT cannot reroute this process (matches the Rust
// is_node_test_child() gate).
const runChildReporterEnabled = process.env[kRunChildEnv] === kRunChildEnvValue;

// Registers this process as a run() child with the native runner, so genuine
// uncaught errors route to the process listeners installed below (spawned
// grandchildren inherit the env var but never register in-process).
const registerRunChild = $newRustFunction("jest.rs", "jsNodeTestRegisterChild", 0);

if (runChildReporterEnabled) {
  // The attribution listeners themselves install lazily with the first test
  // (executeTestNode); an uncaught before that takes the fatal path, like a
  // node test file that dies while loading.
  registerRunChild();
  // node's child emits its root-level plan when the file finishes; the file
  // boundary in bun:test is process exit.
  process.on("exit", () => {
    const count = rootNode?.reportedCount ?? 0;
    if (count > 0) {
      emitRunChildEvent("test:plan", { __proto__: null, nesting: 0, count });
    }
  });
}

// In standalone mode the same events feed an in-process TestsStream instead
// of the parent's stdout pipe.
let standaloneSink: ((type: string, data: unknown) => void) | null = null;

function emitRunChildEvent(type: string, data: unknown) {
  if (standaloneSink !== null) {
    standaloneSink(type, data);
    return;
  }
  // In-process sinks receive the real error object; only the pipe flattens it.
  const record = data as { error?: unknown } | null;
  const wire =
    record !== null && typeof record === "object" && Error.isError(record.error)
      ? { ...record, error: serializeRunError(record.error) }
      : data;
  try {
    process.stdout.write(kRunEventPrefix + JSON.stringify({ type, data: wire }) + "\n");
  } catch {}
}

// True when the run-child event synthesis should be active — either a run()
// child streaming to its parent, or standalone mode reporting in-process.
function runEventsEnabled(): boolean {
  return runChildReporterEnabled || standaloneActive;
}

// node computes durations from hrtime bigints, which carry at most 6 decimal
// digits as milliseconds; raw performance.now() deltas have float noise.
function roundDurationMs(ms: number): number {
  return Math.round(ms * 1e6) / 1e6;
}

// node wraps every user failure in ERR_TEST_FAILURE carrying `failureType` and
// the original error as `cause` (errors.js E('ERR_TEST_FAILURE')).
function wrapTestError(error: unknown): Error {
  if (Error.isError(error)) {
    if ((error as { code?: string }).code === "ERR_TEST_FAILURE") {
      (error as { failureType?: string }).failureType ??= "testCodeFailure";
      return error;
    }
    const wrapper = new Error(error.message);
    (wrapper as { code?: string }).code = "ERR_TEST_FAILURE";
    (wrapper as { failureType?: string }).failureType = "testCodeFailure";
    (wrapper as { cause?: unknown }).cause = error;
    // node's wrapper hides its internal frames; reporters use the cause's stack.
    wrapper.stack = `Error [ERR_TEST_FAILURE]: ${wrapper.message}`;
    return wrapper;
  }
  // node: msg = error?.message ?? error, inspected when not a string.
  const wrapper = new Error(typeof error === "string" ? error : Bun.inspect(error));
  (wrapper as { code?: string }).code = "ERR_TEST_FAILURE";
  (wrapper as { failureType?: string }).failureType = "testCodeFailure";
  (wrapper as { cause?: unknown }).cause = error;
  wrapper.stack = `Error [ERR_TEST_FAILURE]: ${wrapper.message}`;
  return wrapper;
}

// node's top-level tests are nesting 0, so the root node itself doesn't count.
function nestingOf(node: TestNode) {
  let depth = 0;
  for (let cur = node.parent; cur !== undefined && cur.parent !== undefined; cur = cur.parent) depth++;
  return depth;
}

// Errors cross the process boundary as plain JSON; the parent rebuilds an Error.
const kSerializedCauseExtras = ["generatedMessage", "actual", "expected", "operator", "diff"];
function serializeRunError(error: unknown) {
  if (Error.isError(error)) {
    const out: Record<string, unknown> = {
      __proto__: null,
      message: error.message,
      stack: error.stack,
      code: (error as { code?: string }).code,
      failureType: (error as { failureType?: string }).failureType,
      name: error.name,
    };
    const { cause } = error as { cause?: unknown };
    if (Error.isError(cause)) {
      const c = cause as Record<string, unknown> & Error;
      const serializedCause: Record<string, unknown> = {
        __proto__: null,
        message: c.message,
        stack: c.stack,
        code: c.code,
        name: c.name,
      };
      // Only JSON-safe primitives survive the pipe (node uses the v8 serializer).
      for (const key of kSerializedCauseExtras) {
        const value = c[key];
        const t = typeof value;
        if (value === null || t === "string" || t === "number" || t === "boolean") serializedCause[key] = value;
      }
      out.cause = serializedCause;
    }
    return out;
  }
  return { __proto__: null, message: String(error), stack: undefined, code: undefined, name: "Error" };
}

// A test or suite that bun:test will never invoke (the `skip` and `todo`
// options). Node still reports it as a pass carrying the directive.
function reportDirectiveOnlyNode(node: TestNode, mode: "skip" | "todo") {
  if (!runEventsEnabled()) return;
  // `{ skip: true, todo: true }` reports as a skip: node checks `skipped`
  // first and only then `isTodo` (test.js getReportDetails).
  const skipped = node.skipped || mode === "skip";
  reportQueueChain(node);
  const data = {
    __proto__: null,
    name: node.name,
    nesting: nestingOf(node),
    testNumber: nextTestNumberFor(node),
    testId: runTestIdFor(node),
    parentId: runParentIdFor(node),
    duration_ms: 0,
    skip: skipped ? (node.directiveMessage ?? true) : undefined,
    todo: !skipped ? (node.directiveMessage ?? true) : undefined,
    type: node.isSuite ? "suite" : "test",
    tags: node.tags,
    error: undefined,
  };
  emitRunChildEvent("test:complete", { ...data, passed: true });
  reportStartChain(node);
  emitRunChildEvent("test:pass", data);
  // Directive-only nodes never execute, so completion bookkeeping for the
  // enclosing suite happens here.
  noteRunChildDone(node.parent, false);
}

// True when any enclosing suite is marked skipped with a falsy-but-defined
// value ({ skip: '' }): its callback ran and declared children, which node
// cancels instead of running.
function hasSkippedAncestorSuite(node: TestNode): boolean {
  for (let cur = node.parent; cur !== undefined && cur.parent !== undefined; cur = cur.parent) {
    if (cur.isSuite && cur.skipped) return true;
  }
  return false;
}

function makeCancelledByParentError() {
  return makeTestFailure("test did not finish before its parent and was cancelled", "cancelledByParent");
}

// Reports a declared-but-never-run child of a skipped suite (node's
// cancelledByParent verdict). Recurses into a cancelled suite's own declared
// children so every leaf emits cancelledByParent (node's postRun() recurses
// #cancel() + postRun()), otherwise a suite-only subtree lands in counts.suites
// alone and never reaches counts.cancelled, so the run can exit 0.
function reportCancelledNode(node: TestNode) {
  if (!runEventsEnabled()) return;
  reportQueueChain(node);
  const data = {
    __proto__: null,
    name: node.name,
    nesting: nestingOf(node),
    testNumber: nextTestNumberFor(node),
    testId: runTestIdFor(node),
    parentId: runParentIdFor(node),
    duration_ms: 0,
    type: node.isSuite ? "suite" : "test",
    tags: node.tags,
    error: makeCancelledByParentError(),
  };
  emitRunChildEvent("test:complete", { ...data, passed: false });
  if (node.isSuite) {
    node.suiteReported = true;
    for (const child of node.standaloneChildren ?? []) {
      reportCancelledNode(child.node);
    }
    emitRunChildEvent("test:plan", {
      __proto__: null,
      nesting: nestingOf(node) + 1,
      count: node.childrenCount,
    });
  }
  reportStartChain(node);
  emitRunChildEvent("test:fail", data);
  noteRunChildDone(node.parent, true);
}

// node's todo directive is inherited: a test inside a todo suite reports (and
// counts) as todo, and its failure cannot fail the run.
function hasTodoAncestor(node: TestNode): boolean {
  for (let cur = node.parent; cur !== undefined; cur = cur.parent) {
    if (cur.todoFlag) return true;
  }
  return false;
}

let runTestIdCounter = 0;
function runTestIdFor(node: TestNode): number {
  if (node.runTestId === 0) node.runTestId = ++runTestIdCounter;
  return node.runTestId;
}

function runParentIdFor(node: TestNode): number {
  const parent = node.parent;
  return parent !== undefined && parent.parent !== undefined ? runTestIdFor(parent) : 0;
}

function nextTestNumberFor(node: TestNode): number {
  const parent = node.parent;
  return parent !== undefined ? ++parent.reportedCount : 0;
}

// node's per-test flush order: enqueue, dequeue, complete, (subtest plan),
// ancestor starts, own start, verdict — so the queue and start phases are
// separate to let `complete` sit between them.
function reportQueueChain(node: TestNode) {
  if (!runEventsEnabled()) return;
  const chain: TestNode[] = [];
  for (let cur: TestNode | undefined = node; cur !== undefined && cur.parent !== undefined; cur = cur.parent) {
    if (cur.queueReported) break;
    chain.push(cur);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const entry = chain[i];
    entry.queueReported = true;
    const data = {
      __proto__: null,
      name: entry.name,
      nesting: nestingOf(entry),
      type: entry.isSuite ? "suite" : "test",
      testId: runTestIdFor(entry),
      parentId: runParentIdFor(entry),
      tags: entry.tags,
    };
    emitRunChildEvent("test:enqueue", data);
    emitRunChildEvent("test:dequeue", data);
  }
}

function reportStartChain(node: TestNode) {
  if (!runEventsEnabled()) return;
  const chain: TestNode[] = [];
  for (let cur: TestNode | undefined = node; cur !== undefined && cur.parent !== undefined; cur = cur.parent) {
    if (cur.startReported) break;
    chain.push(cur);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const entry = chain[i];
    entry.startReported = true;
    entry.startedAtMs = performance.now();
    emitRunChildEvent("test:start", {
      __proto__: null,
      name: entry.name,
      nesting: nestingOf(entry),
      testId: runTestIdFor(entry),
      parentId: runParentIdFor(entry),
      tags: entry.tags,
    });
  }
}

// A collection suite has no completion callback of its own: it finishes when
// its describe callback has settled (all children registered) AND its last
// registered child has reported.
function noteRunChildDone(parent: TestNode | undefined, failed: boolean) {
  if (!runEventsEnabled()) return;
  // The root node is not a suite node in node's stream.
  while (parent !== undefined && parent.parent !== undefined) {
    parent.childrenDone++;
    if (failed) parent.childrenFailed++;
    if (!maybeCompleteSuite(parent)) return;
    failed = parent.childrenFailed > 0;
    parent = parent.parent;
  }
}

// Emits the suite's own completion event once it is truly finished. Returns
// whether the suite completed (so the caller can bubble to its parent).
function maybeCompleteSuite(suite: TestNode): boolean {
  if (!suite.isSuite || !suite.collectionSettled || suite.suiteReported) return false;
  if (suite.childrenDone < suite.childrenCount) return false;
  suite.suiteReported = true;
  // A todo suite's advisory results never fail it (or the run) in node.
  const isTodo = suite.todoFlag || hasTodoAncestor(suite);
  if (isTodo) suite.childrenFailed = 0;
  let suiteFailed = suite.childrenFailed > 0;
  const failedCount = suite.childrenFailed;
  // node's Suite.pass(): an expectFailure suite with no error still fails
  // ('test was expected to fail but passed'); a failing one keeps its error.
  const { expectFailure } = suite;
  const xfail = expectFailure ? (expectFailure.label ?? true) : undefined;
  let forcedError: Error | undefined;
  if (expectFailure && !suiteFailed && !isTodo) {
    suiteFailed = true;
    // Callers re-derive the bubble-up bit from childrenFailed; write it back
    // (mirroring the isTodo zeroing above) so the parent sees this as failed.
    suite.childrenFailed = 1;
    forcedError = makeTestFailure("test was expected to fail but passed", "expectedFailure");
  }
  const data = {
    __proto__: null,
    name: suite.name,
    nesting: nestingOf(suite),
    testNumber: nextTestNumberFor(suite),
    testId: runTestIdFor(suite),
    parentId: runParentIdFor(suite),
    type: "suite",
    skip: suite.skipped ? (suite.directiveMessage ?? true) : undefined,
    todo: isTodo ? (suite.directiveMessage ?? true) : undefined,
    expectFailure: xfail,
    duration_ms: suite.startedAtMs > 0 ? roundDurationMs(performance.now() - suite.startedAtMs) : 0,
    tags: suite.tags,
    error: suiteFailed
      ? (forcedError ??
        (suite.error != null
          ? wrapTestError(suite.error)
          : makeTestFailure(`${failedCount} subtest${failedCount > 1 ? "s" : ""} failed`, "subtestsFailed")))
      : undefined,
  };
  // node's order around a finishing suite: its completion, the plan covering
  // its children, then its own verdict. The chain calls are no-ops when a
  // child already walked up, but an empty suite has no child to do so.
  reportQueueChain(suite);
  emitRunChildEvent("test:complete", { ...data, passed: !suiteFailed });
  emitRunChildEvent("test:plan", {
    __proto__: null,
    nesting: nestingOf(suite) + 1,
    count: suite.childrenCount,
  });
  reportStartChain(suite);
  emitRunChildEvent(suiteFailed ? "test:fail" : "test:pass", data);
  return true;
}

// Called when a suite's describe callback has finished registering children.
function noteSuiteCollectionSettled(suite: TestNode) {
  if (!runEventsEnabled()) return;
  suite.collectionSettled = true;
  if (maybeCompleteSuite(suite)) {
    noteRunChildDone(suite.parent, suite.childrenFailed > 0);
  }
}

// Registers a child with its enclosing suite for run()-child suite accounting.
// Checks inStandaloneMode() directly: at the first standalone registration
// standaloneActive has not latched yet (standaloneRegister runs after this).
function noteRunChildRegistered(parent: TestNode) {
  if (!runChildReporterEnabled && !inStandaloneMode()) return;
  if (parent.parent !== undefined) parent.childrenCount++;
}

// Called for every test node as its result is finalized, so subtests report
// with the same shape as top-level tests. No-op outside a run() child.
function reportNodeToRunParent(node: TestNode, startedAt: number) {
  if (!runEventsEnabled() || node.isSuite) return;
  const { skipped, expectFailure } = node;
  const todoEffective = node.todoFlag || hasTodoAncestor(node);
  // node reports the xfail label when there is one, otherwise `true`.
  const xfail = !skipped && expectFailure ? (expectFailure.label ?? true) : undefined;
  reportQueueChain(node);
  // node spreads a `directive` into the event: `skip: true` / `todo: true`, with
  // the other key absent entirely.
  const data = {
    __proto__: null,
    name: node.name,
    nesting: nestingOf(node),
    testNumber: nextTestNumberFor(node),
    testId: runTestIdFor(node),
    parentId: runParentIdFor(node),
    duration_ms: roundDurationMs(performance.now() - startedAt),
    skip: skipped ? (node.directiveMessage ?? true) : undefined,
    todo: !skipped && todoEffective ? (node.directiveMessage ?? true) : undefined,
    expectFailure: xfail,
    tags: node.tags,
    error: node.passed ? undefined : wrapTestError(node.error),
  };
  emitRunChildEvent("test:complete", { ...data, passed: node.passed });
  // A test that ran subtests reports the plan covering them.
  const { reportedCount } = node;
  if (reportedCount > 0) {
    emitRunChildEvent("test:plan", { __proto__: null, nesting: nestingOf(node) + 1, count: reportedCount });
  }
  reportStartChain(node);
  emitRunChildEvent(node.passed ? "test:pass" : "test:fail", data);
  // A failing todo child does not fail its suite (node counts it as todo).
  noteRunChildDone(node.parent, !node.passed && !skipped && !todoEffective);
}

// -----------------------------------------------------------------------------
// MockTracker
//
// Port of Node.js lib/internal/test_runner/mock/mock.js (v26.3.0):
//   https://github.com/nodejs/node/blob/50c35fea9e64d50ab3bb5f359e8523de89d6c798/lib/internal/test_runner/mock/mock.js
// API reference: https://nodejs.org/api/test.html#class-mocktracker
// -----------------------------------------------------------------------------
let trackMockCall: (ctx: MockFunctionContext, thisArg: unknown, args: unknown[], target: unknown) => unknown;

class MockFunctionContext {
  #calls: unknown[];
  #implementation: Function | undefined;
  #original: Function;
  #onceImplementations: Map<number, Function>;
  #restore: (() => void) | undefined;
  #times: number;

  constructor(
    original: Function,
    implementation: Function | undefined,
    restore?: () => void,
    times: number = Infinity,
  ) {
    this.#calls = [];
    this.#original = original;
    this.#implementation = implementation;
    this.#onceImplementations = new Map();
    this.#restore = restore;
    this.#times = times;
  }

  get calls() {
    return Array.from(this.#calls);
  }

  callCount(): number {
    return this.#calls.length;
  }

  mockImplementation(implementation: Function) {
    if (!$isCallable(implementation)) {
      throw $ERR_INVALID_ARG_TYPE("implementation", "function", implementation);
    }
    this.#implementation = implementation;
  }

  mockImplementationOnce(implementation: Function, onCall?: number) {
    if (!$isCallable(implementation)) {
      throw $ERR_INVALID_ARG_TYPE("implementation", "function", implementation);
    }
    // node validates the call index: an integer no earlier than the next call
    const nextCall = this.#calls.length;
    const call = onCall ?? nextCall;
    validateInteger(call, "onCall", nextCall);
    this.#onceImplementations.$set(call, implementation);
  }

  resetCalls() {
    this.#calls = [];
  }

  restore() {
    // node semantics: a method mock reinstalls the original descriptor but the
    // context keeps its implementation (calling the detached mock function
    // still uses it); a bare fn mock reverts to calling the original. Queued
    // once-implementations survive, and restore() stays re-runnable so a
    // still-tracked context can be restored again by reset().
    if (this.#restore !== undefined) {
      this.#restore();
    } else {
      this.#implementation = undefined;
    }
  }

  static {
    trackMockCall = function trackMockCall(
      ctx: MockFunctionContext,
      thisArg: unknown,
      args: unknown[],
      target: unknown,
    ) {
      const callIndex = ctx.#calls.length;
      let implementation = ctx.#onceImplementations.$get(callIndex);
      if (implementation !== undefined) {
        ctx.#onceImplementations.$delete(callIndex);
      } else {
        implementation = ctx.#implementation ?? ctx.#original;
      }
      // options.times: revert to the original behavior once the mock has
      // been used `times` times (node decides this before invoking, so the
      // current call still uses the mocked implementation).
      if (callIndex + 1 === ctx.#times) {
        ctx.restore();
      }
      // node records the call in a finally *after* invoking, so a reentrant
      // implementation observes callCount() === N (not N+1), recursive calls
      // record in completion order, and the stack is captured post-invoke.
      let result: unknown;
      let error: unknown;
      const isConstruct = target !== undefined;
      try {
        result = !isConstruct
          ? (implementation as Function).$apply(thisArg, args)
          : Reflect.construct(implementation as Function, args, target as Function);
        return result;
      } catch (e) {
        error = e;
        throw e;
      } finally {
        // node's mock is a Proxy over the original, so its construct trap
        // records the proxy's target (the original) and the new instance.
        ctx.#calls.push({
          arguments: args,
          error,
          result,
          stack: new Error(),
          target: isConstruct ? ctx.#original : undefined,
          this: isConstruct ? result : thisArg,
        });
      }
    };
  }
}

class MockPropertyContext {
  #object: object;
  #propertyName: PropertyKey;
  #value: unknown;
  #originalValue: unknown;
  #descriptor: PropertyDescriptor;
  #accesses: unknown[];
  #onceValues: Map<number, unknown>;

  constructor(object: object, propertyName: PropertyKey, value?: unknown) {
    this.#onceValues = new Map();
    this.#accesses = [];
    this.#object = object;
    this.#propertyName = propertyName;
    this.#originalValue = object[propertyName];
    this.#value = arguments.length > 2 ? value : this.#originalValue;
    const descriptor = Object.getOwnPropertyDescriptor(object, propertyName);
    if (!descriptor) {
      throw $ERR_INVALID_ARG_VALUE("propertyName", propertyName, "is not a property of the object");
    }
    this.#descriptor = descriptor;

    const { configurable, enumerable } = descriptor;
    Object.defineProperty(object, propertyName, {
      // @ts-ignore
      __proto__: null,
      configurable,
      enumerable,
      get: () => {
        const nextValue = this.#getAccessValue(this.#value);
        this.#accesses.push({
          type: "get",
          value: nextValue,
          stack: new Error(),
        });
        return nextValue;
      },
      set: this.mockImplementation.bind(this),
    });
  }

  get accesses() {
    return this.#accesses.slice(0);
  }

  accessCount(): number {
    return this.#accesses.length;
  }

  mockImplementation(value: unknown) {
    if (!this.#descriptor.writable) {
      throw $ERR_INVALID_ARG_VALUE("propertyName", this.#propertyName, "cannot be set");
    }
    const nextValue = this.#getAccessValue(value);
    this.#accesses.push({
      type: "set",
      value: nextValue,
      stack: new Error(),
    });
    this.#value = nextValue;
  }

  #getAccessValue(value: unknown) {
    const accessIndex = this.#accesses.length;
    if (this.#onceValues.$has(accessIndex)) {
      const accessValue = this.#onceValues.$get(accessIndex);
      this.#onceValues.$delete(accessIndex);
      return accessValue;
    }
    return value;
  }

  mockImplementationOnce(value: unknown, onAccess?: number) {
    const nextAccess = this.#accesses.length;
    const accessIndex = onAccess ?? nextAccess;
    validateInteger(accessIndex, "onAccess", nextAccess);
    this.#onceValues.$set(accessIndex, value);
  }

  resetAccesses() {
    this.#accesses = [];
  }

  restore() {
    Object.defineProperty(this.#object, this.#propertyName, {
      // @ts-ignore
      __proto__: null,
      ...this.#descriptor,
      value: this.#originalValue,
    });
  }
}

function validateTimes(value: unknown, name: string) {
  if (value === Infinity) {
    return;
  }
  validateInteger(value, name, 1);
}

function validateStringOrSymbol(value: unknown, name: string) {
  if (typeof value !== "string" && typeof value !== "symbol") {
    throw $ERR_INVALID_ARG_TYPE(name, ["string", "symbol"], value);
  }
}

// Functions declared inside bun's builtins get no `prototype`, but node's
// default original is a plain `function () {}`, so give it one explicitly.
function createDefaultOriginal(): Function {
  const original = function () {};
  Object.defineProperty(original, "prototype", {
    // @ts-ignore
    __proto__: null,
    value: {},
    writable: true,
    enumerable: false,
    configurable: false,
  });
  return original;
}

class MockTracker {
  #mocks: { ctx: { restore: () => void } }[] = [];
  #timers: unknown;
  // Set on the module-level tracker: registering into it from a new file's
  // module scope must run the file-boundary reset (getRootNode) first.
  #isFileScoped: boolean = false;

  static createFileScoped(): MockTracker {
    const tracker = new MockTracker();
    tracker.#isFileScoped = true;
    return tracker;
  }

  // File-scoped registrations must run the file-boundary reset (getRootNode)
  // BEFORE capturing any state, or a new file's module-scope mock.method()
  // would snapshot the previous file's still-installed mock as the original.
  #syncEntryFile(): void {
    if (this.#isFileScoped) getRootNode();
  }

  #createMockFunction(
    original: Function,
    implementation: Function | undefined,
    restore?: () => void,
    times: number = Infinity,
  ) {
    const context = new MockFunctionContext(original, implementation, restore, times);
    this.#mocks.push({ ctx: context });
    function mockFunction(this: unknown, ...args: unknown[]) {
      return trackMockCall(context, this, args, new.target);
    }
    Object.defineProperty(mockFunction, "mock", {
      // @ts-ignore
      __proto__: null,
      value: context,
      writable: false,
      enumerable: false,
    });
    Object.defineProperty(mockFunction, "length", {
      // @ts-ignore
      __proto__: null,
      value: original.length,
      configurable: true,
    });
    Object.defineProperty(mockFunction, "name", {
      // @ts-ignore
      __proto__: null,
      value: original.name,
      configurable: true,
    });
    // node's mock proxies the original, so `.prototype` reads through to it:
    // mirror the value and its writability (a class's prototype is read-only,
    // and a method/arrow original has no prototype at all).
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(original, "prototype");
    Object.defineProperty(mockFunction, "prototype", {
      // @ts-ignore
      __proto__: null,
      value: prototypeDescriptor?.value,
      writable: prototypeDescriptor?.writable ?? true,
    });
    return mockFunction;
  }

  fn(original?: Function | object, implementation?: Function | object, options?: object) {
    this.#syncEntryFile();
    if (original !== null && original !== undefined && !$isCallable(original) && typeof original === "object") {
      options = implementation as object;
      implementation = original;
      original = undefined;
    }
    if (
      implementation !== null &&
      implementation !== undefined &&
      !$isCallable(implementation) &&
      typeof implementation === "object"
    ) {
      options = implementation as object;
      implementation = undefined;
    }
    if (original !== undefined && !$isCallable(original)) {
      throw $ERR_INVALID_ARG_TYPE("original", "function", original);
    }
    if (implementation !== undefined && !$isCallable(implementation)) {
      throw $ERR_INVALID_ARG_TYPE("implementation", "function", implementation);
    }
    if (options !== undefined) {
      validateObject(options, "options");
    }
    const { times = Infinity } = (options ?? kEmptyObject) as { times?: number };
    validateTimes(times, "options.times");
    return this.#createMockFunction(
      (original as Function) ?? createDefaultOriginal(),
      implementation as Function | undefined,
      undefined,
      times,
    );
  }

  method(
    objectOrFunction: object | Function,
    methodName: PropertyKey,
    implementation?: Function | object,
    options?: { getter?: boolean; setter?: boolean } | object,
  ) {
    this.#syncEntryFile();
    if (
      implementation !== null &&
      implementation !== undefined &&
      !$isCallable(implementation) &&
      typeof implementation === "object"
    ) {
      options = implementation;
      implementation = undefined;
    }
    if (implementation !== undefined && !$isCallable(implementation)) {
      throw $ERR_INVALID_ARG_TYPE("implementation", "function", implementation);
    }
    if ((typeof objectOrFunction !== "object" || objectOrFunction === null) && !$isCallable(objectOrFunction)) {
      throw $ERR_INVALID_ARG_TYPE("object", "object", objectOrFunction);
    }
    if (typeof methodName !== "string" && typeof methodName !== "symbol") {
      throw $ERR_INVALID_ARG_TYPE("methodName", ["string", "symbol"], methodName);
    }
    if (options !== undefined) {
      validateObject(options, "options");
    }
    const {
      getter = false,
      setter = false,
      times = Infinity,
    } = (options ?? kEmptyObject) as {
      getter?: boolean;
      setter?: boolean;
      times?: number;
    };
    validateBoolean(getter, "options.getter");
    validateBoolean(setter, "options.setter");
    validateTimes(times, "options.times");
    if (setter && getter) {
      throw $ERR_INVALID_ARG_VALUE("options.setter", setter, "cannot be used with 'options.getter'");
    }

    // Find the descriptor on the object or its prototype chain.
    let target: object | null = objectOrFunction;
    let descriptor: PropertyDescriptor | undefined;
    while (target !== null) {
      descriptor = Object.getOwnPropertyDescriptor(target, methodName);
      if (descriptor !== undefined) break;
      target = Object.getPrototypeOf(target);
    }
    if (descriptor === undefined) {
      throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a method");
    }

    let original: Function;
    if (getter) {
      if (!$isCallable(descriptor.get)) {
        throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a getter");
      }
      original = descriptor.get!;
    } else if (setter) {
      if (!$isCallable(descriptor.set)) {
        throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a setter");
      }
      original = descriptor.set!;
    } else {
      if (!$isCallable(descriptor.value)) {
        throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a method");
      }
      original = descriptor.value;
    }

    const restore = function restore() {
      // @ts-ignore
      Object.defineProperty(objectOrFunction, methodName, { __proto__: null, ...descriptor! });
    };
    const mocked = this.#createMockFunction(original, implementation as Function | undefined, restore, times);

    const mockDescriptor: PropertyDescriptor = {
      // @ts-ignore
      __proto__: null,
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
    };
    if (getter || setter) {
      if (getter) {
        mockDescriptor.get = mocked;
        mockDescriptor.set = descriptor.set;
      } else {
        mockDescriptor.get = descriptor.get;
        mockDescriptor.set = mocked;
      }
    } else {
      mockDescriptor.value = mocked;
      mockDescriptor.writable = descriptor.writable;
    }
    Object.defineProperty(objectOrFunction, methodName, mockDescriptor);
    return mocked;
  }

  getter(
    objectOrFunction: object | Function,
    methodName: PropertyKey,
    implementation?: Function | object,
    options?: object,
  ) {
    // Shift implementation -> options *before* spreading, or the shift inside
    // method() would clobber the getter flag (node does the same).
    if (
      implementation !== null &&
      implementation !== undefined &&
      !$isCallable(implementation) &&
      typeof implementation === "object"
    ) {
      options = implementation;
      implementation = undefined;
    }
    const { getter = true } = (options ?? kEmptyObject) as { getter?: boolean };
    if (getter === false) {
      throw $ERR_INVALID_ARG_VALUE("options.getter", getter, "cannot be false");
    }
    return this.method(objectOrFunction, methodName, implementation as Function | undefined, {
      ...options,
      getter,
    });
  }

  setter(
    objectOrFunction: object | Function,
    methodName: PropertyKey,
    implementation?: Function | object,
    options?: object,
  ) {
    if (
      implementation !== null &&
      implementation !== undefined &&
      !$isCallable(implementation) &&
      typeof implementation === "object"
    ) {
      options = implementation;
      implementation = undefined;
    }
    const { setter = true } = (options ?? kEmptyObject) as { setter?: boolean };
    if (setter === false) {
      throw $ERR_INVALID_ARG_VALUE("options.setter", setter, "cannot be false");
    }
    return this.method(objectOrFunction, methodName, implementation as Function | undefined, {
      ...options,
      setter,
    });
  }

  property(object: object, propertyName: PropertyKey, value?: unknown) {
    this.#syncEntryFile();
    validateObject(object, "object");
    validateStringOrSymbol(propertyName, "propertyName");

    const ctx =
      arguments.length > 2
        ? new MockPropertyContext(object, propertyName, value)
        : new MockPropertyContext(object, propertyName);
    this.#mocks.push({ ctx });

    return new Proxy(object, {
      get(target, property, receiver) {
        if (property === "mock") {
          return ctx;
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  get timers() {
    this.#syncEntryFile();
    if (this.#timers === undefined) {
      const { MockTimers } = require("internal/test_runner/mock_timers");
      this.#timers = new MockTimers();
    }
    return this.#timers;
  }

  reset() {
    // restoreAll() plus disassociating the mocks from the tracker, like node.
    this.restoreAll();
    (this.#timers as { reset: () => void } | undefined)?.reset();
    this.#mocks = [];
  }

  restoreAll() {
    // Restores method mocks to their original descriptor and makes bare
    // mock.fn() mocks call their original function again, like node. Unlike
    // reset(), the mocks stay associated with the tracker.
    for (const { ctx } of this.#mocks) ctx.restore();
  }

  module() {
    throwNotImplemented("mock.module()", 5090, "Use `bun:test` in the interim.");
  }
}

// The module-level tracker is reset automatically at each test-file boundary
// (see getRootNode), matching Node's per-process module state.
const mock = MockTracker.createFileScoped();

// -----------------------------------------------------------------------------
// Assertions (t.assert + custom assertion registry)
// -----------------------------------------------------------------------------

function fileSnapshot(_value: unknown, _path: string, _options: { serializers?: Function[] } = kEmptyObject) {
  throwNotImplemented("fileSnapshot()", 5090, "Use `bun:test` in the interim.");
}

function snapshot(_value: unknown, _options: { serializers?: Function[] } = kEmptyObject) {
  throwNotImplemented("snapshot()", 5090, "Use `bun:test` in the interim.");
}

const nodeAssert = require("node:assert");
const { innerOk } = require("internal/assert/utils");

// Custom assertions registered through `require("node:test").assert.register()`.
// They become part of every TestContext's `t.assert` built afterwards.
// Prototype-less so lookups never go through user-reachable Map/Object methods.
let customAssertions: Record<string, Function> = { __proto__: null } as unknown as Record<string, Function>;

function registerCustomAssertion(name: string, fn: Function) {
  validateString(name, "name");
  validateFunction(fn, "fn");
  // Run the file-boundary reset first so a registration made at module scope,
  // before the file's first test, is not wiped by that test's registration.
  getRootNode();
  customAssertions[name] = fn;
}

const assert = {
  ...nodeAssert,
  fileSnapshot,
  snapshot,
  register: registerCustomAssertion,
};

// Delete deprecated methods on assert (required to pass node's tests)
delete assert.AssertionError;
delete assert.CallTracker;
delete assert.strict;

function buildContextAssert(node: TestNode, ctx: TestContext) {
  // Per-context assert namespace, prototype-less like Node's: node:assert
  // methods (minus the uncopied ones), snapshot/fileSnapshot, and custom
  // assertions; each call counts the plan and binds the TestContext.
  const result: Record<string, Function> = { __proto__: null } as unknown as Record<string, Function>;
  // Node captures `plan` once at first `t.assert` access and closes over it,
  // so `t.assert; t.plan(2); t.assert.ok(1)` counts 0 (nodejs/node
  // lib/internal/test_runner/test.js:331). Match that.
  const { plan } = node;
  const add = (name: string, method: Function) => {
    const wrapper = function (...args: unknown[]) {
      plan?.count();
      return method.$apply(ctx, args);
    };
    // @ts-ignore
    Object.defineProperty(wrapper, "name", { __proto__: null, value: name, configurable: true });
    result[name] = wrapper;
  };
  for (const key of Object.keys(nodeAssert)) {
    // CallTracker is also excluded: bun's node:assert still ships it (Node 26
    // does not), and copying it would trigger its deprecation accessor.
    // `ok` is installed below, outside the generic wrapper.
    if (key === "AssertionError" || key === "strict" || key === "CallTracker" || key === "ok") continue;
    const value = nodeAssert[key];
    if (!$isCallable(value)) continue;
    add(key, value);
  }
  add("snapshot", snapshot);
  add("fileSnapshot", fileSnapshot);
  for (const name of Object.keys(customAssertions)) {
    add(name, customAssertions[name]);
  }
  // `ok` is its own stackStartFn so the trace starts at the caller instead of a
  // node:test wrapper frame; a registered `ok` still wins (nodejs/node@028c5864).
  if (customAssertions.ok === undefined) {
    result.ok = function ok(...args: unknown[]) {
      plan?.count();
      innerOk(ok, args.length, ...args);
    };
  }
  return result;
}

// -----------------------------------------------------------------------------
// Test plan
// -----------------------------------------------------------------------------

function makeTestFailure(message: string, failureType?: string) {
  const error = new Error(message);
  (error as { code?: string }).code = "ERR_TEST_FAILURE";
  if (failureType !== undefined) (error as { failureType?: string }).failureType = failureType;
  // node's ERR_TEST_FAILURE hides its internal frames (hideInternalStackFrames),
  // so reporters print no stack for these wrappers.
  error.stack = `Error [ERR_TEST_FAILURE]: ${message}`;
  return error;
}

class TestPlan {
  expected: number;
  actual = 0;
  wait: boolean | number;
  #pending:
    | { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> | undefined }
    | undefined;

  constructor(count: number, options: { wait?: boolean | number } = kEmptyObject) {
    validateUint32(count, "count");
    validateObject(options, "options");
    const { wait = false } = options;
    if (typeof wait === "number") {
      validateNumber(wait, "options.wait", 0, kTimeoutMax);
    } else if (typeof wait !== "boolean" && wait !== undefined) {
      throw $ERR_INVALID_ARG_TYPE("options.wait", ["boolean", "number"], wait);
    }
    this.expected = count;
    this.wait = wait ?? false;
  }

  count() {
    this.actual++;
    if (this.#pending !== undefined && this.actual >= this.expected) {
      const pending = this.#pending;
      this.#pending = undefined;
      const { timer } = pending;
      if (timer !== undefined) realClearTimeout(timer);
      pending.resolve();
    }
  }

  check(): undefined | Promise<void> {
    const { actual, expected, wait } = this;
    if (actual === expected) {
      return;
    }
    if (wait === false || wait === undefined || actual > expected) {
      throw makeTestFailure(`plan expected ${expected} assertions but received ${actual}`, "testCodeFailure");
    }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (typeof wait === "number") {
        timer = realSetTimeout(() => {
          this.#pending = undefined;
          reject(
            makeTestFailure(
              `plan timed out after ${wait}ms with ${this.actual} assertions when expecting ${expected}`,
              "testCodeFailure",
            ),
          );
        }, wait);
        // Not unref'd: count()/cancel()/the timer callback always clear it, and
        // on Windows an unref'd timer alone under bun:test busy-spins (8664279d).
      } else {
        // wait === true: keep a ref'd handle so an .unref()'d user timer still
        // fires on Windows while this await is the only work (see above).
        timer = realSetTimeout(() => {}, kTimeoutMax);
      }
      this.#pending = { resolve, reject, timer };
    });
  }

  // An uncaughtException attributed to the awaiting test must reject a
  // pending wait, or the test would hang on a plan that can no longer be met.
  failPending(err: Error) {
    const pending = this.#pending;
    if (pending === undefined) return false;
    this.#pending = undefined;
    const { timer } = pending;
    if (timer !== undefined) realClearTimeout(timer);
    pending.reject(err);
    return true;
  }

  // Mirrors count()'s cleanup for the stop-wins-race path: if the test-level
  // timeout fires before a numeric {wait: K} is fulfilled, the ref'd plan
  // timer must not stay armed for K - N more ms after the test reported.
  cancel() {
    const pending = this.#pending;
    if (pending === undefined) return;
    this.#pending = undefined;
    const { timer } = pending;
    if (timer !== undefined) realClearTimeout(timer);
  }
}

// t.test() counts against the parent's plan; only t.assert.* uses the
// captured-at-first-access snapshot (Node reads this.#test.plan fresh here).
function planCount(node: TestNode) {
  node.plan?.count();
}

// -----------------------------------------------------------------------------
// Tags
// -----------------------------------------------------------------------------

const kEmptyTags: string[] = Object.freeze([]) as string[];

function canonicalizeTags(tags: unknown, name: string): string[] {
  validateArray(tags, name);
  const seen = new Set<string>();
  for (let i = 0; i < (tags as unknown[]).length; i++) {
    const tag = (tags as unknown[])[i];
    validateString(tag, `${name}[${i}]`);
    if (tag === "") {
      throw $ERR_INVALID_ARG_VALUE(`${name}[${i}]`, tag, "must not be an empty string");
    }
    seen.add((tag as string).toLowerCase());
  }
  if (seen.size > 0) emitTagsExperimentalWarning();
  return Array.from(seen);
}

// -----------------------------------------------------------------------------
// Async context tracking for getTestContext()
// -----------------------------------------------------------------------------

let asyncLocalStorage: { getStore(): TestNode | undefined; run<T>(store: TestNode, fn: () => T): T } | undefined;

function getAsyncLocalStorage() {
  if (asyncLocalStorage === undefined) {
    const { AsyncLocalStorage } = require("node:async_hooks");
    asyncLocalStorage = new AsyncLocalStorage();
  }
  return asyncLocalStorage;
}

function currentNode(): TestNode | undefined {
  return asyncLocalStorage?.getStore();
}

function runWithNode<T>(node: TestNode, fn: () => T): T {
  return getAsyncLocalStorage().run(node, fn);
}

function getTestContext(): TestContext | SuiteContext | undefined {
  const node = currentNode();
  if (node === undefined) return undefined;
  // The root has isSuite=true but parent=undefined; Node's root is a Test,
  // so match hookArgFor() and give it a TestContext.
  return node.isSuite && node.parent !== undefined ? node.getSuiteCtx() : node.getCtx();
}

// -----------------------------------------------------------------------------
// TestNode: internal runner state shared by TestContext/SuiteContext
// -----------------------------------------------------------------------------

// `timeout`/`signal` are snapshotted at creation (Node validates and stores them
// on the TestHook). `result` memoizes a before hook's one run, like Node's
// runOnce(): every replay observes the same outcome, including the failure.
type Hook = { fn: Function; timeout: number | undefined; signal: AbortSignal | undefined; result?: Promise<void> };
type HookSets = { before: Hook[]; after: Hook[]; beforeEach: Hook[]; afterEach: Hook[] };

class TestNode {
  name: string;
  parent: TestNode | undefined;
  isSuite: boolean;
  // "collection" nodes register with bun:test; "execution" nodes run inline as subtests.
  isExecutionPhase: boolean;
  filePath: string | undefined;
  options: TestOptions;
  ownTags: string[] | undefined;
  hooks: HookSets = { before: [], after: [], beforeEach: [], afterEach: [] };
  plan: TestPlan | null = null;
  mockTracker: MockTracker | null = null;
  skipped = false;
  todoFlag = false;
  // Set by both {only: true} and the .only spelling, so pruneToOnly sees
  // node's two equivalent spellings the same way (it.only === it({only:true})).
  onlyFlag = false;
  // The skip/todo reason string ({ skip: 'reason' }, t.skip('reason')).
  directiveMessage: string | null = null;
  abortController: AbortController | undefined;
  expectFailure: ExpectFailure = false;
  started = false;
  // run()-child suite accounting: a collection suite completes when its last
  // registered child reports, at which point its own suite event is emitted.
  childrenCount = 0;
  childrenDone = 0;
  childrenFailed = 0;
  collectionSettled = false;
  suiteReported = false;
  queueReported = false;
  startReported = false;
  startedAtMs = 0;
  // node numbers each reported child 1..n within its parent.
  reportedCount = 0;
  // Stable per-instance id carried on every per-test event.
  runTestId = 0;
  // Standalone mode: children collected at declaration, run on beforeExit.
  standaloneChildren: StandaloneEntry[] | undefined;
  finished = false;
  passed = false;
  error: unknown = null;
  // Inline subtests are serialized through this chain. `concurrency` is
  // validated for Node-compat error codes but subtests always run serially.
  subtestChain: Promise<void> = Promise.resolve();
  failedSubtests = 0;
  firstSubtestError: unknown = undefined;
  // First failure from a before hook created while this test was running.
  hookFailure: unknown = undefined;
  #ctx: TestContext | undefined;
  #suiteCtx: SuiteContext | undefined;
  #tags: string[] | undefined;

  constructor(
    name: string,
    parent: TestNode | undefined,
    options: TestOptions,
    isSuite: boolean,
    isExecutionPhase: boolean,
  ) {
    this.name = name;
    this.parent = parent;
    this.options = options;
    this.isSuite = isSuite;
    this.isExecutionPhase = isExecutionPhase;
    // Direct children of the root capture the entry file at declaration time
    // (under `bun test` with multiple files, Bun.main is the file currently
    // being collected); nested tests inherit their parent's file.
    this.filePath =
      parent !== undefined && parent.parent !== undefined ? parent.filePath : (currentImportFile ?? Bun.main);
    // node: any non-undefined, non-false value is a directive, including ''.
    const { skip, todo } = options;
    this.skipped = skip !== undefined && skip !== false;
    this.todoFlag = (todo !== undefined && todo !== false) || (parent?.todoFlag ?? false);
    this.onlyFlag = !!options.only;
    this.directiveMessage = typeof skip === "string" ? skip : typeof todo === "string" ? todo : null;
    this.expectFailure = parseExpectFailure(options.expectFailure) || parent?.expectFailure || false;
  }

  get tags(): string[] {
    if (this.#tags === undefined) {
      const parentTags = this.parent?.tags ?? kEmptyTags;
      const own = this.ownTags ?? kEmptyTags;
      if (parentTags.length === 0 && own.length === 0) {
        this.#tags = kEmptyTags;
      } else {
        const merged = new Set<string>(parentTags);
        for (const tag of own) merged.add(tag);
        this.#tags = Object.freeze(Array.from(merged)) as string[];
      }
    }
    return this.#tags;
  }

  get fullName(): string {
    const names: string[] = [];
    let node: TestNode | undefined = this;
    while (node !== undefined && node.parent !== undefined) {
      names.unshift(node.name);
      node = node.parent;
    }
    if (names.length === 0) {
      return this.name;
    }
    return names.join(kJoinSeparator);
  }

  getCtx(): TestContext {
    this.#ctx ??= new TestContext(this);
    return this.#ctx;
  }

  getSuiteCtx(): SuiteContext {
    this.#suiteCtx ??= new SuiteContext(this);
    return this.#suiteCtx;
  }

  // True while user code reached from this node should treat new tests as
  // inline subtests instead of bun:test registrations.
  isRunning(): boolean {
    return (this.started && !this.finished) || this.isExecutionPhase;
  }
}

// Bumped by the runner's enter_file. Bound privately rather than read off the
// bun:test module object, which is public API.
const fileGeneration = $newRustFunction("jest.rs", "jsFileGeneration", 0);
// Overrides the running bun:test sequence result: `false` → skip, `true` → todo.
// `done` binds the intended sequence so a late call after the bun:test watchdog
// moved on cannot write onto the currently-running test.
const markCurrentResult = $newRustFunction("jest.rs", "jsNodeTestMarkResult", 2);

let rootNode: TestNode | undefined;
let rootGeneration = -1;

function getRootNode(): TestNode {
  // Fresh root on each runner enter_file (per file AND per --rerun-each
  // iteration) so file-level hooks/state never leak between them; Bun.main
  // alone can't detect a rerun of the same file.
  const generation = fileGeneration();
  if (rootNode === undefined || rootGeneration !== generation) {
    const oldRoot = rootNode;
    rootGeneration = generation;
    // Publish the new root before resetting so re-entrant calls (user code run
    // by a mock's restore) see an up-to-date root and don't reset again.
    rootNode = new TestNode(kRootName, undefined, kDefaultOptions, true, false);
    if (oldRoot !== undefined) {
      // Node also scopes these per process: drop the previous file's
      // module-level mocks and assert.register() additions with its root.
      // The root's own mockTracker (reachable via a file-level before hook's
      // `t.mock`) is distinct from the module-level `mock` export.
      oldRoot.mockTracker?.reset();
      mock.reset();
      customAssertions = { __proto__: null } as unknown as Record<string, Function>;
      tagsExperimentalWarningEmitted = false;
    }
  }
  return rootNode;
}

// -----------------------------------------------------------------------------
// Contexts
// -----------------------------------------------------------------------------

/**
 * @link https://nodejs.org/api/test.html#class-testcontext
 */
class TestContext {
  #node: TestNode;
  #assert: Record<string, Function> | undefined;

  constructor(node: TestNode) {
    this.#node = node;
  }

  get signal(): AbortSignal {
    // Owned by the node so a timeout can abort it (node's #cancel()).
    const node = this.#node;
    node.abortController ??= new AbortController();
    return node.abortController.signal;
  }

  get name(): string {
    return this.#node.name;
  }

  get fullName(): string {
    return this.#node.fullName;
  }

  get filePath(): string {
    return this.#node.filePath!;
  }

  get error(): unknown {
    return this.#node.error;
  }

  get passed(): boolean {
    return this.#node.passed;
  }

  get attempt(): number {
    return 0;
  }

  get workerId(): number | undefined {
    return Number(process.env.NODE_TEST_WORKER_ID) || undefined;
  }

  get tags(): string[] {
    return this.#node.tags;
  }

  diagnostic(message: string) {
    console.log(message);
  }

  plan(count: number, options: { wait?: boolean | number } = kEmptyObject) {
    const node = this.#node;
    if (node.plan !== null) {
      throw makeTestFailure("cannot set plan more than once");
    }
    node.plan = new TestPlan(count, options);
  }

  get assert() {
    this.#assert ??= buildContextAssert(this.#node, this);
    return this.#assert;
  }

  get mock(): MockTracker {
    const node = this.#node;
    node.mockTracker ??= new MockTracker();
    return node.mockTracker;
  }

  runOnly(_value?: boolean) {
    throwNotImplemented("runOnly()", 5090, "Use `bun:test` in the interim.");
  }

  skip(message?: string) {
    this.#node.skipped = true;
    if (typeof message === "string") this.#node.directiveMessage = message;
  }

  todo(message?: string) {
    this.#node.todoFlag = true;
    if (typeof message === "string") this.#node.directiveMessage = message;
  }

  before(arg0: unknown, arg1: unknown) {
    const hook = createHook(arg0, arg1);
    const node = this.#node;
    node.hooks.before.push(hook);
    if (node.started && !node.finished) {
      // Node runs before hooks created on an already-started test immediately.
      scheduleImmediateBeforeHook(node, hook, this);
    }
  }

  after(arg0: unknown, arg1: unknown) {
    this.#node.hooks.after.push(createHook(arg0, arg1));
  }

  beforeEach(arg0: unknown, arg1: unknown) {
    this.#node.hooks.beforeEach.push(createHook(arg0, arg1));
  }

  afterEach(arg0: unknown, arg1: unknown) {
    this.#node.hooks.afterEach.push(createHook(arg0, arg1));
  }

  waitFor(condition: unknown, options: { interval?: number; timeout?: number } = kEmptyObject) {
    validateFunction(condition, "condition");
    validateObject(options, "options");
    const { interval = 50, timeout = 1000 } = options;
    validateNumber(interval, "options.interval", 0, kTimeoutMax);
    validateNumber(timeout, "options.timeout", 0, kTimeoutMax);

    return new Promise((resolve, reject) => {
      let cause: unknown;
      let hasCause = false;
      let timedOut = false;
      let retry: ReturnType<typeof realSetTimeout> | undefined;
      const timer = realSetTimeout(() => {
        timedOut = true;
        // Cancel a pending retry so condition() is not invoked again after
        // reject (Node clears its pollerId in done()).
        if (retry !== undefined) realClearTimeout(retry);
        const error = new Error("waitFor() timed out");
        if (hasCause) {
          (error as { cause?: unknown }).cause = cause;
        }
        reject(error);
      }, timeout);

      const poll = async () => {
        try {
          const result = await (condition as Function)();
          if (timedOut) return;
          realClearTimeout(timer);
          resolve(result);
        } catch (err) {
          if (timedOut) return;
          cause = err;
          hasCause = true;
          retry = realSetTimeout(poll, interval);
        }
      };
      poll();
    });
  }

  test(arg0: unknown, arg1: unknown, arg2: unknown) {
    const node = this.#node;
    planCount(node);
    return addTest(arg0, arg1, arg2, node);
  }

  describe(arg0: unknown, arg1: unknown, arg2: unknown) {
    return addSuite(arg0, arg1, arg2, this.#node);
  }
}

/**
 * @link https://nodejs.org/api/test.html#class-suitecontext
 */
class SuiteContext {
  #node: TestNode;
  #abortController?: AbortController;

  constructor(node: TestNode) {
    this.#node = node;
  }

  get signal(): AbortSignal {
    if (this.#abortController === undefined) {
      this.#abortController = new AbortController();
    }
    return this.#abortController.signal;
  }

  get name(): string {
    return this.#node.name;
  }

  get fullName(): string {
    return this.#node.fullName;
  }

  get filePath(): string {
    return this.#node.filePath!;
  }

  get passed(): boolean {
    return this.#node.passed;
  }

  get attempt(): number {
    return 0;
  }

  diagnostic(message: string) {
    console.log(message);
  }
}

// -----------------------------------------------------------------------------
// Option parsing & validation
// -----------------------------------------------------------------------------

type TestFn = (ctx: TestContext | SuiteContext) => unknown | Promise<unknown>;
type HookFn = (ctx?: unknown) => unknown | Promise<unknown>;

type TestOptions = {
  concurrency?: number | boolean | null;
  only?: boolean;
  signal?: AbortSignal;
  skip?: boolean | string;
  todo?: boolean | string;
  timeout?: number;
  plan?: number;
  tags?: string[];
  expectFailure?: unknown;
};

type HookOptions = {
  signal?: AbortSignal;
  timeout?: number;
};

function parseTestArgs(arg0: unknown, arg1: unknown, arg2: unknown) {
  let name: string;
  let options: TestOptions;
  let fn: TestFn;

  if (typeof arg0 === "function") {
    name = arg0.name || kDefaultName;
    fn = arg0 as TestFn;
    if (typeof arg1 === "object") {
      options = (arg1 ?? kDefaultOptions) as TestOptions;
    } else {
      options = kDefaultOptions;
    }
  } else if (typeof arg0 === "string") {
    name = arg0;
    if (typeof arg1 === "object") {
      options = (arg1 ?? kDefaultOptions) as TestOptions;
      if (typeof arg2 === "function") {
        fn = arg2 as TestFn;
      } else {
        fn = kDefaultFunction;
      }
    } else if (typeof arg1 === "function") {
      fn = arg1 as TestFn;
      options = kDefaultOptions;
    } else {
      fn = kDefaultFunction;
      options = kDefaultOptions;
    }
  } else if (typeof arg0 === "object" && arg0 !== null) {
    options = arg0 as TestOptions;
    if (typeof arg1 === "function") {
      fn = arg1 as TestFn;
      name = fn.name || kDefaultName;
    } else {
      fn = kDefaultFunction;
      name = kDefaultName;
    }
  } else {
    name = kDefaultName;
    fn = kDefaultFunction;
    options = kDefaultOptions;
  }

  return { name, options, fn };
}

// Shared by test and hook options: Node validates both the same way.
function validateTimeoutAndSignal(options: TestOptions | HookOptions) {
  const { timeout, signal } = options;
  if (signal !== undefined) {
    validateAbortSignal(signal, "options.signal");
  }
  if (timeout != null && timeout !== Infinity) {
    validateNumber(timeout, "options.timeout", 0, kTimeoutMax);
  }
}

// Port of Node's parseExpectFailure (test.js:528). A string is a label, a
// function or RegExp validates the error, an object may carry both, and any
// other object is itself the validation.
type ExpectFailure = false | { label?: string; match?: unknown };

function parseExpectFailure(expectFailure: unknown): ExpectFailure {
  if (expectFailure === undefined || expectFailure === false) return false;
  if (typeof expectFailure === "string") return { __proto__: null, label: expectFailure, match: undefined } as any;
  if (typeof expectFailure === "function" || $isRegExpObject(expectFailure)) {
    return { __proto__: null, label: undefined, match: expectFailure } as any;
  }
  if (typeof expectFailure !== "object") {
    return { __proto__: null, label: undefined, match: undefined } as any;
  }
  // `null` reaches Object.keys and throws, exactly as it does in node.
  const keys = Object.keys(expectFailure as object);
  if (keys.length === 0) {
    throw $ERR_INVALID_ARG_VALUE("options.expectFailure", expectFailure, "must not be an empty object");
  }
  if (keys.every(k => k === "match" || k === "label")) {
    return {
      __proto__: null,
      label: (expectFailure as { label?: string }).label,
      match: (expectFailure as { match?: unknown }).match,
    } as any;
  }
  return { __proto__: null, label: undefined, match: expectFailure } as any;
}

// Node inverts the verdict of an expectFailure test: a failure is the expected
// outcome, and passing is itself a failure (test.js:1120-1184).
function applyExpectFailure(node: TestNode, failure: unknown): unknown {
  const expectation = node.expectFailure;
  if (!expectation) return failure;

  if (failure !== undefined) {
    const validation = expectation.match;
    if (validation !== undefined) {
      // Only a wrapped test-code failure has an inner cause to validate; a bare
      // ERR_TEST_FAILURE (a timeout, a plan mismatch) has none and is itself
      // the error to check.
      const wrapped = failure as { code?: string; failureType?: string; cause?: unknown };
      const unwrap =
        wrapped?.code === "ERR_TEST_FAILURE" &&
        wrapped.failureType === "testCodeFailure" &&
        wrapped.cause !== undefined;
      const errorToCheck = unwrap ? wrapped.cause : failure;
      try {
        nodeAssert.throws(() => {
          throw errorToCheck;
        }, validation);
      } catch (e) {
        const error = makeTestFailure(
          "The test failed, but the error did not match the expected validation",
          "testCodeFailure",
        );
        (error as { cause?: unknown }).cause = e;
        return error;
      }
    }
    return undefined;
  }

  if (node.skipped) return undefined;
  return makeTestFailure("test was expected to fail but passed", "expectedFailure");
}

function validateTestOptions(options: TestOptions): { ownTags: string[] | undefined } {
  const { concurrency, tags, plan } = options;

  // signal and concurrency are validated for Node's error contract but not yet
  // enforced (t.signal never aborts; subtests always run serially).
  validateTimeoutAndSignal(options);
  if (concurrency != null && typeof concurrency !== "boolean") {
    if (typeof concurrency === "number") {
      validateUint32(concurrency, "options.concurrency", true);
    } else {
      throw $ERR_INVALID_ARG_TYPE("options.concurrency", ["boolean", "number"], concurrency);
    }
  }
  if (plan !== undefined) {
    validateUint32(plan, "options.plan");
  }

  let ownTags: string[] | undefined;
  if (tags !== undefined) {
    ownTags = canonicalizeTags(tags, "options.tags");
  }

  return { ownTags };
}

function parseHookArgs(arg0: unknown, arg1: unknown) {
  let fn: HookFn;
  let options: HookOptions;

  if (typeof arg0 === "function") {
    fn = arg0 as HookFn;
  } else {
    fn = kDefaultFunction;
  }

  if (typeof arg1 === "object" && arg1 !== null) {
    options = arg1 as HookOptions;
  } else {
    options = kDefaultOptions;
  }

  return { fn, options };
}

function createHook(arg0: unknown, arg1: unknown): Hook {
  const { fn, options } = parseHookArgs(arg0, arg1);
  // Node validates hook options in the TestHook constructor and snapshots them.
  validateTimeoutAndSignal(options);
  const { signal, timeout } = options;
  return { fn, timeout, signal, result: undefined };
}

// -----------------------------------------------------------------------------
// Execution engine
// -----------------------------------------------------------------------------

function ancestorChain(node: TestNode): TestNode[] {
  // Returns [root, ..., parent] (outermost first), excluding `node` itself.
  const chain: TestNode[] = [];
  let current = node.parent;
  while (current !== undefined) {
    chain.unshift(current);
    current = current.parent;
  }
  return chain;
}

function invokeWithDoneCallback(fn: Function, arg: unknown) {
  return new Promise<void>((resolve, reject) => {
    let returned = false;
    let returnedPromise = false;
    let doneCalled = false;
    let doneError: unknown;
    const done = (err?: unknown) => {
      if (doneCalled) {
        // Node throws into the caller when the callback is invoked again.
        throw makeTestFailure("callback invoked multiple times", "multipleCallbackInvocations");
      }
      doneCalled = true;
      // A done() call made before the function returned is deferred, and one
      // made after a promise was returned is ignored: returning a promise from
      // a callback function always fails, like Node.
      if (!returned) {
        doneError = err;
        return;
      }
      if (returnedPromise) {
        return;
      }
      if (err) reject(err);
      else resolve();
    };
    // Node invokes test/hook callbacks with `this` bound to the context.
    const result = fn.$call(arg, arg, done);
    returned = true;
    if ($isPromise(result)) {
      // Node fails the test but still awaits the returned promise, so hooks
      // and later tests never race a still-running body.
      returnedPromise = true;
      const fail = () =>
        reject(makeTestFailure("passed a callback but also returned a Promise", "callbackAndPromisePresent"));
      (result as Promise<unknown>).then(fail, fail);
      return;
    }
    if (doneCalled) {
      if (doneError) reject(doneError);
      else resolve();
    }
  });
}

// Node passes a `done` callback when a test or hook function declares exactly
// two parameters; completion is then done()'s call, not the returned value.
// Node invokes describe callbacks with `this` bound to the SuiteContext.
function invokeSuiteFn(fn: Function, ctx: unknown) {
  return fn.$call(ctx, ctx);
}

function invokeTestFn(fn: Function, arg: unknown) {
  if (fn.length === 2) {
    return invokeWithDoneCallback(fn, arg);
  }
  return fn.$call(arg, arg);
}

// A single timeout armed once per test and raced against both the body and
// plan.check(), matching Node's stopTest()/stopPromise. `promise` never
// resolves; it only rejects with the timeout error. Callers must dispose().
function createStopController(timeout: number | undefined) {
  if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
    return undefined;
  }
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    // Not unref'd: dispose() always clears it, and on Windows an unref'd timer
    // alone under bun:test leaves the uws loop inactive so auto_tick busy-spins.
    timer = realSetTimeout(
      () => reject(makeTestFailure(`test timed out after ${timeout}ms`, "testTimeoutFailure")),
      timeout,
    );
  });
  // Swallow the rejection when nothing is racing it anymore.
  promise.catch(() => {});
  return { promise, dispose: () => realClearTimeout(timer) };
}

// Runs `run` racing Node's test timeout; the timer starts before the body so a
// long synchronous prefix counts against the timeout, like Node.
function awaitWithTimeout(run: () => unknown, timeout: number | undefined) {
  if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
    return run();
  }
  return raceWithTimeoutAndSignal(run, timeout, undefined);
}

let addAbortListener;

async function raceWithTimeoutAndSignal(
  run: () => unknown,
  timeout: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener;
  try {
    const racers: unknown[] = [];
    if (typeof timeout === "number" && Number.isFinite(timeout)) {
      racers.push(
        new Promise<never>((_, reject) => {
          timer = realSetTimeout(
            () => reject(makeTestFailure(`test timed out after ${timeout}ms`, "testTimeoutFailure")),
            timeout,
          );
        }),
      );
    }
    if (signal !== undefined) {
      if (signal.aborted) {
        throw signal.reason;
      }
      addAbortListener ??= require("internal/abort_listener").addAbortListener;
      racers.push(
        new Promise<never>((_, reject) => {
          abortListener = addAbortListener(signal, () => reject(signal.reason));
        }),
      );
    }
    racers.push(run());
    await Promise.race(racers);
  } finally {
    // If run() settled first the loser promises stay pending forever, which is
    // harmless; only the timer and the abort listener need to be released.
    if (timer !== undefined) realClearTimeout(timer);
    abortListener?.[Symbol.dispose]();
  }
}

async function runHook(hook: Hook, owner: TestNode, arg: unknown) {
  const { timeout, signal } = hook;
  const run = () => runWithNode(owner, () => invokeTestFn(hook.fn as Function, arg));
  try {
    if (signal === undefined) {
      await awaitWithTimeout(run, timeout);
    } else {
      await raceWithTimeoutAndSignal(run, timeout, signal);
    }
  } catch (err) {
    // A hook that throws a nullish value must still fail the owning test.
    throw err ?? makeTestFailure("hook failed");
  }
}

// Node runs each before hook at most once (runOnce) and memoizes the outcome:
// after a failure, every later subtest observes the same rejection.
function runBeforeHookOnce(hook: Hook, owner: TestNode, arg: unknown): Promise<void> {
  return (hook.result ??= runHook(hook, owner, arg));
}

// Failures fail the owning test (Node: hook.error -> test.fail) instead of
// poisoning the subtest chain, so they are reported even when nothing awaits.
function scheduleImmediateBeforeHook(node: TestNode, hook: Hook, arg: unknown) {
  node.subtestChain = node.subtestChain.then(async () => {
    try {
      await runBeforeHookOnce(hook, node, arg);
    } catch (err) {
      node.hookFailure ??= err;
    }
  });
}

async function runOwnBeforeHooks(node: TestNode) {
  // Node runs suites strictly sequentially, so a subtest is gated on the before
  // hooks of every enclosing inline suite and the owning test, outermost first;
  // runBeforeHookOnce memoizes each, so the racing siblings share one result.
  const owners: TestNode[] = [];
  for (let owner: TestNode | undefined = node; owner !== undefined; owner = owner.parent) {
    owners.unshift(owner);
    // Stop at the owning collection-phase test/suite: hooks above it were
    // registered through bun:test's own beforeAll and are not run by the shim.
    if (!owner.isExecutionPhase) break;
  }
  for (const owner of owners) {
    const { before } = owner.hooks;
    if (before.length === 0) continue;
    const arg = owner.isSuite ? owner.getSuiteCtx() : owner.getCtx();
    for (const hook of before) {
      await runBeforeHookOnce(hook, owner, arg);
    }
  }
}

// Tests currently executing in this process (innermost last), plus an
// AsyncLocalStorage tying async work to the test whose body created it —
// node's harness attributes process errors via async context.
type ExecutionEntry = { node: TestNode; fail: (err: Error) => void };
const executionStack: ExecutionEntry[] = [];
let processErrorAttributionInstalled = false;
let testContextStorage:
  | { run: (store: TestNode, fn: () => unknown) => unknown; getStore: () => TestNode | undefined }
  | undefined;

function getTestContextStorage() {
  testContextStorage ??= new (require("node:async_hooks").AsyncLocalStorage)();
  return testContextStorage!;
}

function attributeProcessError(err: unknown, failureType: string): void {
  const store = testContextStorage?.getStore();
  let entry: ExecutionEntry | undefined;
  if (store !== undefined && store.finished) {
    // Another test's late async activity: node reports this at root level and
    // fails the run without blaming the currently running test.
    console.error((err as Error)?.stack ?? err);
    process.exitCode = 1;
    return;
  }
  if (store !== undefined) {
    entry = executionStack.find(e => e.node === store);
  }
  // No tracked context (bun's ALS does not cover promise-rejection sweeps or
  // every native source): fall back to the innermost running test.
  entry ??= executionStack[executionStack.length - 1];
  if (entry !== undefined && !entry.node.finished) {
    const wrapper = wrapTestError(err) as { failureType?: string };
    wrapper.failureType = failureType;
    entry.fail(wrapper as Error);
    return;
  }
  // No active test: node's fatal path — print and exit 1 (kGenericUserError).
  console.error((err as Error)?.stack ?? err);
  process.exit(1);
}

const attributeUncaught = (err: unknown) => attributeProcessError(err, "uncaughtException");
const attributeUnhandled = (err: unknown) => attributeProcessError(err, "unhandledRejection");

function installProcessErrorAttribution() {
  if (processErrorAttributionInstalled) return;
  processErrorAttributionInstalled = true;
  getTestContextStorage();
  process.on("uncaughtException", attributeUncaught);
  process.on("unhandledRejection", attributeUnhandled);
}

// Listeners latch for the process; remove them when an in-process run hands
// control back to a caller whose own uncaughtException handling must not be
// swallowed (the listener's presence alone suppresses the default print+exit).
function uninstallProcessErrorAttribution() {
  if (!processErrorAttributionInstalled) return;
  processErrorAttributionInstalled = false;
  process.off("uncaughtException", attributeUncaught);
  process.off("unhandledRejection", attributeUnhandled);
}

async function executeTestNode(node: TestNode, fn: TestFn): Promise<unknown> {
  // Runs a single test (top-level or subtest): inherited beforeEach hooks, the
  // body, pending subtests, the plan check, inherited afterEach hooks, and the
  // test's own after hooks. Returns the failure (if any) instead of throwing.
  node.started = true;
  const started = runEventsEnabled() ? performance.now() : 0;
  const ctx = node.getCtx();
  const ancestors = ancestorChain(node);
  let failure: unknown;

  // Node applies the plan option before the beforeEach hooks run, and only for a
  // truthy count, so `{ plan: 0 }` installs no plan at all (test.js:1313-1315).
  // `t.assert` snapshots the plan at first access, so hooks must see it already.
  const { plan: planOption } = node.options;
  if (planOption && node.plan === null) {
    node.plan = new TestPlan(planOption);
  }

  try {
    for (const ancestor of ancestors) {
      for (const hook of ancestor.hooks.beforeEach) {
        await runHook(hook, ancestor, ctx);
      }
    }
  } catch (err) {
    failure = err;
  }

  // While this test runs, an uncaughtException/unhandledRejection belongs to
  // it (node fails the test instead of crashing the process). The interrupt
  // promise unblocks a body that can no longer settle (e.g. awaiting forever).
  let execEntry: ExecutionEntry | undefined;
  let interrupt: { promise: Promise<never>; reject: (err: Error) => void } | undefined;
  if (runEventsEnabled()) {
    installProcessErrorAttribution();
    let rejectInterrupt!: (err: Error) => void;
    const interruptPromise = new Promise<never>((_, reject) => {
      rejectInterrupt = reject;
    });
    interruptPromise.catch(() => {});
    interrupt = { promise: interruptPromise, reject: rejectInterrupt };
    execEntry = {
      node,
      fail: err => {
        if (node.finished) return;
        node.hookFailure ??= err;
        node.plan?.failPending(err);
        interrupt!.reject(err);
      },
    };
    executionStack.push(execEntry);
  }

  if (failure === undefined) {
    // Node arms one stopPromise (timeout + signal) and races both the body
    // AND the plan wait against it. Arm timeout once here so plan({wait:true})
    // is bounded by the same test timeout, not left unbounded.
    const stop = createStopController(node.options.timeout);
    try {
      const runBody = async () => {
        // The body runs inside the test's async context so late async work
        // (timers, ticks) is attributed to this test, like node.
        const invoke = () => runWithNode(node, () => invokeTestFn(fn, ctx));
        await (execEntry !== undefined ? getTestContextStorage().run(node, invoke) : invoke());
        // Wait for inline subtests created during the body (awaited or not),
        // including ones scheduled while earlier subtests were running.
        await drainSubtestChain(node);
      };

      // Races the body/plan against the test timeout AND external interrupts
      // (attributed uncaught errors that must unblock a pending await).
      const raceExternal = (p: unknown) => {
        const racers: unknown[] = [];
        if (stop !== undefined) racers.push(stop.promise);
        if (interrupt !== undefined) racers.push(interrupt.promise);
        if (racers.length === 0) return p;
        racers.push(p);
        return Promise.race(racers as Promise<unknown>[]);
      };

      try {
        await raceExternal(runBody());
      } catch (err) {
        // A body that throws or rejects with a nullish value must still fail.
        failure = err ?? makeTestFailure("test failed");
      }

      // A before hook created while the test was running failed (Node fails the
      // test with the hook's error).
      failure ??= node.hookFailure;

      const { plan } = node;
      if (failure === undefined && plan !== null) {
        try {
          const pending = plan.check();
          if (pending !== undefined) {
            // Defuse: if stop wins the race, plan's own wait-timeout may still
            // reject `pending` afterward with no one listening.
            pending.catch(() => {});
            await raceExternal(pending);
            // A t.test() that fulfilled the plan from an async callback was
            // scheduled onto subtestChain during the wait; drain again so its
            // failure reaches failedSubtests below (Node fails the parent).
            const drain = drainSubtestChain(node);
            await raceExternal(drain);
          }
        } catch (err) {
          failure = err;
        }
      }
    } finally {
      stop?.dispose();
      node.plan?.cancel();
    }

    // An error attributed while the body was in flight fails the test.
    failure ??= node.hookFailure;

    const { failedSubtests, firstSubtestError } = node;
    if (failure === undefined && failedSubtests > 0) {
      const error = makeTestFailure(
        `${failedSubtests} subtest${failedSubtests > 1 ? "s" : ""} failed`,
        "subtestsFailed",
      );
      if (firstSubtestError !== undefined) {
        (error as { cause?: unknown }).cause = firstSubtestError;
      }
      failure = error;
    }
  }

  if (execEntry !== undefined) {
    const at = executionStack.lastIndexOf(execEntry);
    if (at !== -1) executionStack.splice(at, 1);
  }

  // node cancels (rather than fails) a timed-out test and aborts t.signal.
  if ((failure as { failureType?: string } | undefined)?.failureType === "testTimeoutFailure") {
    (node.abortController ??= new AbortController()).abort();
  }

  failure = applyExpectFailure(node, failure);

  // Node sets passed/error before running afterEach/after so hooks can
  // introspect the outcome (nodejs/node lib/internal/test_runner/test.js
  // pass()/fail() precede afterEach).
  node.passed = failure === undefined;
  node.error = failure ?? null;
  // Mark finished before hooks so a late t.test() from an after/afterEach
  // hook hits addTest()'s parentAlreadyFinished path (Node cancels these).
  node.finished = true;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    for (const hook of ancestor.hooks.afterEach) {
      try {
        await runHook(hook, ancestor, ctx);
      } catch (err) {
        failure ??= err;
      }
    }
  }

  for (const hook of node.hooks.after) {
    try {
      await runHook(hook, node, ctx);
    } catch (err) {
      failure ??= err;
    }
  }

  try {
    node.mockTracker?.reset();
  } catch (err) {
    failure ??= err;
  }

  node.passed = failure === undefined;
  node.error = failure ?? null;
  reportNodeToRunParent(node, started);
  return failure;
}

function scheduleSubtest(parent: TestNode, child: TestNode, fn: TestFn): Promise<undefined> {
  const run = async () => {
    if (child.options.skip) {
      child.finished = true;
      child.passed = true;
      return;
    }
    let failure: unknown;
    try {
      await runOwnBeforeHooks(parent);
      failure = await executeTestNode(child, fn);
    } catch (err) {
      failure = err;
    }
    if (failure !== undefined && !child.todoFlag && !child.skipped) {
      parent.failedSubtests++;
      parent.firstSubtestError ??= failure;
    }
  };
  const result = (parent.subtestChain = parent.subtestChain.then(run));
  return result.then(() => undefined);
}

function recordSuiteFailure(suite: TestNode, err: unknown) {
  suite.failedSubtests++;
  suite.firstSubtestError ??= err ?? makeTestFailure("suite failed");
}

// Awaits a node's subtest chain, including links appended while waiting.
async function drainSubtestChain(node: TestNode) {
  let chain;
  do {
    chain = node.subtestChain;
    try {
      await chain;
    } catch {
      // Failures are tracked through failedSubtests.
    }
  } while (chain !== node.subtestChain);
}

function scheduleSuiteSubtest(parent: TestNode, suite: TestNode, build: unknown): Promise<undefined> {
  // A describe()/suite() created while a test is running becomes a suite
  // subtest: its children were collected eagerly when the callback ran and are
  // already chained on the suite's own subtestChain; failures roll up here.
  const run = async () => {
    if (build !== undefined) {
      try {
        // An async describe() callback that rejects fails the suite (Node
        // awaits the suite build).
        await build;
      } catch (err) {
        recordSuiteFailure(suite, err);
      }
    }
    try {
      await runOwnBeforeHooks(suite);
    } catch (err) {
      // A failing suite-level before hook fails the suite, like Node.
      recordSuiteFailure(suite, err);
    }
    // Wait for children created during the callback and any they schedule.
    await drainSubtestChain(suite);
    for (const hook of suite.hooks.after) {
      try {
        await runHook(hook, suite, suite.getSuiteCtx());
      } catch (err) {
        recordSuiteFailure(suite, err);
      }
    }
    suite.finished = true;
    suite.passed = suite.failedSubtests === 0;
    // A todo suite's failures do not fail the owning test (Node).
    if (suite.failedSubtests > 0 && !suite.todoFlag) {
      parent.failedSubtests++;
      parent.firstSubtestError ??= suite.firstSubtestError;
    }
    // Align accounting with what actually reported and settle, so the suite's
    // test:complete/plan/verdict match the enqueue/dequeue/start its first
    // child already emitted walking up.
    if (runEventsEnabled()) {
      suite.childrenCount = suite.reportedCount;
      suite.childrenDone = suite.reportedCount;
      if (!suite.passed) suite.childrenFailed ||= suite.failedSubtests;
      noteSuiteCollectionSettled(suite);
    }
  };
  const result = (parent.subtestChain = parent.subtestChain.then(run));
  return result.then(() => undefined);
}

// -----------------------------------------------------------------------------
// Registration with bun:test
// -----------------------------------------------------------------------------

function bunTest() {
  return jest(Bun.main);
}

// -----------------------------------------------------------------------------
// Standalone mode — `bun file.js` on a file that uses node:test. Node
// bootstraps its runner lazily on the first registration (harness.js
// lazyBootstrapRoot) and runs the queue on beforeExit; outside `bun test`
// there is no native runner, so the shim does the same with its own
// execution machinery and the node:test/reporters port.
// -----------------------------------------------------------------------------
type StandaloneEntry = {
  node: TestNode;
  fn: TestFn;
  isSuite: boolean;
  mode?: "skip";
  build?: Promise<unknown>;
};

let standaloneActive = false;
let standaloneScheduled = false;
// True while run({ isolation: 'none' }) imports and executes files in-process:
// registrations queue standalone-style even under `bun test`, and no
// beforeExit pass is scheduled (the run loop drains the queue itself).
let inProcessRunActive = false;
// The file being imported (registration) / executed (events) by an in-process run.
let currentImportFile: string | null = null;
let activeRunFile: string | null = null;
const standaloneQueue: StandaloneEntry[] = [];

function inStandaloneMode(): boolean {
  if (inProcessRunActive) return true;
  if (standaloneActive) return true;
  if (runChildReporterEnabled) return false;
  // The native runner's file generation is 0 iff this process is not
  // `bun test` (jsFileGeneration returns 0 without an active TestRunner).
  // standaloneActive only latches on an actual registration, so probing here
  // (e.g. from a preload before the runner's first file) is side-effect free.
  return fileGeneration() === 0;
}

function standaloneRegister(entry: StandaloneEntry) {
  standaloneActive = true;
  if (inProcessRunActive) {
    // The in-process run loop drains the queue; no beforeExit pass.
    standaloneScheduled = true;
  }
  const parent = entry.node.parent;
  if (parent !== undefined && parent.parent !== undefined) {
    (parent.standaloneChildren ??= []).push(entry);
  } else {
    standaloneQueue.push(entry);
  }
  if (!standaloneScheduled) {
    standaloneScheduled = true;
    process.once("beforeExit", runStandalone);
  }
}

// Runs root before hooks, the queued entries, then root after hooks.
// Returns the root hook failure (if any) so callers fail the run cleanly
// instead of destroying the stream.
async function executeStandaloneQueue(root: TestNode): Promise<unknown> {
  let hookError: unknown;
  // Node's root is a Test, not a Suite; hookArgFor() hands root a TestContext.
  const rootArg = hookArgFor(root);
  for (const hook of root.hooks.before) {
    try {
      // Memoized: hooks that ran immediately (started root) are not re-run.
      await runBeforeHookOnce(hook, root, rootArg);
    } catch (err) {
      hookError = err;
      break;
    }
  }
  if (hookError === undefined) {
    // Entries can register more entries (rare); index loop tolerates growth.
    for (let i = 0; i < standaloneQueue.length; i++) {
      await runStandaloneEntry(standaloneQueue[i]);
    }
  }
  standaloneQueue.length = 0;
  for (const hook of root.hooks.after) {
    try {
      await runHook(hook, root, rootArg);
    } catch (err) {
      hookError ??= err;
    }
  }
  return hookError;
}

// Recursively awaits every suite's build promise so late-registered children
// (from an async describe body that yielded past import) are in place before
// pruning walks standaloneChildren. Rejections are handled at runStandaloneEntry.
async function awaitSuiteBuilds(entries: StandaloneEntry[]): Promise<void> {
  for (const entry of entries) {
    const { build } = entry;
    if (build !== undefined) {
      try {
        await build;
      } catch {}
    }
    const children = entry.node.standaloneChildren;
    if (children !== undefined) await awaitSuiteBuilds(children);
  }
}

function entryHasOnly(entry: StandaloneEntry): boolean {
  if (entry.node.onlyFlag) return true;
  for (const child of entry.node.standaloneChildren ?? []) {
    if (entryHasOnly(child)) return true;
  }
  return false;
}

function standaloneQueueHasOnly(entries: StandaloneEntry[]): boolean {
  return entries.some(entryHasOnly);
}

// Keeps only-marked branches: an only suite keeps all children; a plain suite
// with only-marked descendants keeps just those branches.
function pruneToOnly(entries: StandaloneEntry[]): StandaloneEntry[] {
  const kept: StandaloneEntry[] = [];
  for (const entry of entries) {
    if (entry.node.onlyFlag) {
      kept.push(entry);
      continue;
    }
    if (!entry.isSuite) continue;
    if (!entryHasOnly(entry)) continue;
    const keptChildren = pruneToOnly(entry.node.standaloneChildren ?? []);
    entry.node.standaloneChildren = keptChildren;
    entry.node.childrenCount = keptChildren.length;
    kept.push(entry);
  }
  return kept;
}

function tagsMatchFilters(tags: string[], filters: string[]): boolean {
  for (const tag of tags) {
    if (filters.includes(tag)) return true;
  }
  return false;
}

// Drops tests whose (inherited) tags miss every filter; a suite survives only
// if any descendant does, and its child accounting shrinks to the survivors.
function pruneStandaloneEntries(entries: StandaloneEntry[], filters: string[]): StandaloneEntry[] {
  const kept: StandaloneEntry[] = [];
  for (const entry of entries) {
    if (!entry.isSuite) {
      if (tagsMatchFilters(entry.node.tags, filters)) kept.push(entry);
      continue;
    }
    const keptChildren = pruneStandaloneEntries(entry.node.standaloneChildren ?? [], filters);
    entry.node.standaloneChildren = keptChildren;
    entry.node.childrenCount = keptChildren.length;
    if (keptChildren.length > 0) kept.push(entry);
  }
  return kept;
}

// run({ isolation: 'none' }): every file imports into this process (all
// registrations first, like node), then one merged queue executes with shared
// root hooks. Events flow through the same restructuring as process isolation.
async function runFilesInProcess(opts: ReturnType<typeof validateRunOptions>, reporter: TestsStream) {
  const started = performance.now();
  const counts = makeRunCounts();
  // A standalone caller may already have queued its own tests; they belong to
  // its beforeExit pass, not to this run. Saved here so the restore helper
  // (function scope) can hand them back.
  const callerEntries = standaloneQueue.splice(0, standaloneQueue.length);
  const wasStandaloneActive = standaloneActive;
  const wasScheduled = standaloneScheduled;
  const hadAttribution = processErrorAttributionInstalled;
  // The root node is a process singleton outside `bun test`; its per-run fields
  // are snapshotted so a second run (or the caller's own beforeExit pass) starts
  // clean and does not re-fire this run's root after() hooks.
  const callerRoot = getRootNode();
  const savedRootHooks = callerRoot.hooks;
  const savedRootReportedCount = callerRoot.reportedCount;
  const savedSink = standaloneSink;
  callerRoot.hooks = { before: [], after: [], beforeEach: [], afterEach: [] };
  callerRoot.reportedCount = 0;

  // Callers attach listeners synchronously on the returned stream; yield first.
  await Promise.resolve();

  try {
    if (typeof opts.setup === "function") await opts.setup(reporter);

    const files = discoverRunFiles(opts);
    standaloneSink = inProcessSinkImpl.bind(undefined, reporter, counts);
    // node's root test is already running while files load, so before() hooks
    // registered at a file's top level execute immediately, in file order.
    getRootNode().started = true;
    try {
      for (const file of files) {
        if (file === Bun.main) {
          // Importing the entry module from inside its own evaluation can
          // never settle (the import awaits the very evaluation that is
          // awaiting the run); node skips the file in this shape too.
          process.emitWarning(
            "node:test run() is being called recursively within a test file. skipping running files.",
          );
          continue;
        }
        currentImportFile = file;
        try {
          await import(file);
        } catch (err) {
          // A file that fails to load is itself a failing test node. Emitted
          // directly (not through republishChildEvent), so top-level numbering
          // is taken from the same counter the republish path bumps.
          const testNumber = ++counts.topLevel;
          const fileNode = {
            __proto__: null,
            name: file,
            nesting: 0,
            file,
            testId: ++runTestIdCounter,
            parentId: 0,
            tags: [],
          };
          reporter.emitMessage("test:enqueue", { ...fileNode, type: "test" });
          reporter.emitMessage("test:dequeue", { ...fileNode, type: "test" });
          reporter.emitMessage("test:complete", {
            ...fileNode,
            testNumber,
            details: { __proto__: null, duration_ms: 0, type: "test", passed: false, error: err },
          });
          reporter.emitMessage("test:start", { ...fileNode });
          reporter.emitMessage("test:fail", {
            ...fileNode,
            testNumber,
            details: { __proto__: null, duration_ms: 0, type: "test", error: err },
          });
          counts.tests++;
          counts.failed++;
        }
      }
    } finally {
      currentImportFile = null;
    }

    // Pruning walks standaloneChildren, which an async describe body may still
    // be appending to; node awaits Suite.buildPromise before consulting them.
    // Awaited unconditionally: a late it.only() would otherwise be invisible
    // to the only-scan itself, and the helper is near-free with no builds.
    await awaitSuiteBuilds(standaloneQueue);
    const filters = opts.testTagFilterExpressions as string[] | null;
    if (filters !== null && filters.length > 0) {
      const pruned = pruneStandaloneEntries(standaloneQueue, filters);
      standaloneQueue.length = 0;
      standaloneQueue.push(...pruned);
    }

    // node honors `only` in the shared process: when any registration carries
    // it, everything outside the only-marked branches is dropped silently.
    if (standaloneQueueHasOnly(standaloneQueue)) {
      const pruned = pruneToOnly(standaloneQueue);
      standaloneQueue.length = 0;
      standaloneQueue.push(...pruned);
    }

    const root = getRootNode();
    const hookError = await executeStandaloneQueue(root);
    if (hookError !== undefined) {
      console.error(hookError);
      counts.failed++;
    }

    const durationMs = roundDurationMs(performance.now() - started);
    // counts.topLevel covers both the republished entries and the failed-import
    // file nodes emitted above (root.reportedCount only the former).
    const { topLevel } = counts;
    if (topLevel > 0) {
      standaloneSink("test:plan", { __proto__: null, nesting: 0, count: topLevel });
    }
    emitRunDiagnostics(reporter, counts, durationMs);
    reporter.emitMessage("test:summary", {
      __proto__: null,
      success: counts.failed === 0 && counts.cancelled === 0,
      counts,
      duration_ms: durationMs,
      file: undefined,
    });
  } catch (err) {
    restoreAfterInProcessRun();
    reporter.destroy(err as Error);
    return;
  }
  restoreAfterInProcessRun();
  reporter.endStream();

  function restoreAfterInProcessRun() {
    inProcessRunActive = false;
    standaloneSink = savedSink;
    activeRunFile = null;
    // Give the caller its own tests and mode flags back so a standalone file
    // that also calls run() still gets its beforeExit pass (finding: the run
    // must not latch standalone state for the rest of the process).
    const root = getRootNode();
    root.started = false;
    root.hooks = savedRootHooks;
    root.reportedCount = savedRootReportedCount;
    standaloneQueue.push(...callerEntries);
    standaloneActive = wasStandaloneActive || callerEntries.length > 0;
    standaloneScheduled = wasScheduled;
    // Remove listeners this run installed so the caller's own (or the default)
    // uncaughtException/unhandledRejection handling is not suppressed.
    if (!hadAttribution) uninstallProcessErrorAttribution();
  }
}

function inProcessSinkImpl(reporter: TestsStream, counts: Record<string, number>, type: string, data: unknown) {
  republishChildEvent({ type, data }, activeRunFile ?? Bun.main, reporter, counts);
}

async function runStandalone() {
  const stream = createTestsStream();
  const counts = makeRunCounts();
  const startedAt = performance.now();

  // The standalone sink feeds the same restructuring path the run() parent
  // uses, so reporters see node's event shapes. Hoisted fn + bind, per the
  // builtin convention for long-lived callbacks.
  standaloneSink = standaloneSinkImpl.bind(undefined, stream, counts);

  // All pipes attach before any test emits: node awaits setupTestReporters()
  // during bootstrap, otherwise a custom reporter's import() yields with an
  // earlier pipe already flowing and it receives a truncated stream.
  const reporterFlush: Promise<void>[] = [];
  await attachStandaloneReporters(stream, reporterFlush);
  const reporterDone = Promise.all(reporterFlush);
  const root = getRootNode();

  try {
    const hookError = await executeStandaloneQueue(root);
    if (hookError !== undefined) {
      console.error(hookError);
      counts.failed++;
    }
  } catch (err) {
    console.error(err);
    counts.failed++;
  } finally {
    const durationMs = roundDurationMs(performance.now() - startedAt);
    const { reportedCount } = root;
    if (reportedCount > 0) {
      standaloneSink!("test:plan", { __proto__: null, nesting: 0, count: reportedCount });
    }
    emitRunDiagnostics(stream, counts, durationMs);
    stream.emitMessage("test:summary", {
      __proto__: null,
      success: counts.failed === 0 && counts.cancelled === 0,
      counts,
      duration_ms: durationMs,
      file: undefined,
    });
    stream.endStream();
    standaloneSink = null;
    await reporterDone;
    if (counts.failed > 0 || counts.cancelled > 0) process.exitCode = 1;
    // node's harness calls process.exit() after postRun when the flag is set;
    // mirrors the eval driver's handling for the --test path.
    if (process.execArgv.includes("--test-force-exit")) {
      process.exit(process.exitCode ?? 0);
    }
  }
}

function standaloneSinkImpl(stream: TestsStream, counts: Record<string, number>, type: string, data: unknown) {
  republishChildEvent({ type, data }, Bun.main, stream, counts);
}

async function runStandaloneEntry(entry: StandaloneEntry) {
  const { node, fn, isSuite, mode } = entry;
  activeRunFile = node.filePath ?? null;
  if (mode === "skip") {
    // Never executes; its directive event is its completion.
    if (isSuite) node.suiteReported = true;
    reportDirectiveOnlyNode(node, "skip");
    return;
  }
  if (!isSuite) {
    // executeTestNode reports the node's events itself.
    await executeTestNode(node, fn);
    return;
  }
  if (node.isSuite && node.skipped) {
    // A skipped suite whose callback still ran (falsy-but-defined skip):
    // node cancels the declared children without running them or the hooks.
    for (const child of node.standaloneChildren ?? []) {
      reportCancelledNode(child.node);
    }
    noteSuiteCollectionSettled(node);
    return;
  }
  // Suites: the callback already ran at declaration (node runs describe
  // bodies during load); execute the collected children in order.
  const isTodoSuite = node.todoFlag || hasTodoAncestor(node);
  // A failing build/before() means setup never completed; node cancels the
  // declared children (cancelledByParent) instead of running them against
  // broken setup. Matches executeStandaloneQueue's root-hook handling. A sync
  // describe throw left node.error set with build undefined (addSuite's catch),
  // so seed from that too.
  let setupFailed = !isTodoSuite && node.error != null;
  const { build } = entry;
  if (build !== undefined) {
    try {
      await build;
    } catch (err) {
      if (!isTodoSuite) {
        node.childrenFailed++;
        node.error = err;
        setupFailed = true;
      }
    }
  }
  if (!setupFailed) {
    for (const hook of node.hooks.before) {
      try {
        await runHook(hook, node, node.getSuiteCtx());
      } catch (err) {
        // A todo suite's hook failure is advisory, like in the run() child.
        if (!isTodoSuite) {
          node.childrenFailed++;
          node.error = err;
          setupFailed = true;
          break;
        }
      }
    }
  }
  if (setupFailed) {
    for (const child of node.standaloneChildren ?? []) {
      reportCancelledNode(child.node);
    }
  } else {
    for (const child of node.standaloneChildren ?? []) {
      await runStandaloneEntry(child);
    }
  }
  for (const hook of node.hooks.after) {
    try {
      await runHook(hook, node, node.getSuiteCtx());
    } catch (err) {
      if (!isTodoSuite) {
        node.childrenFailed++;
        node.error = err;
      }
    }
  }
  // Settle + complete + bubble to the parent in one step.
  noteSuiteCollectionSettled(node);
}

async function attachStandaloneReporters(stream: TestsStream, promises: Promise<void>[]): Promise<void> {
  const reporters = require("node:test/reporters");
  const names: string[] = [];
  const destinationNames: string[] = [];
  const argv = process.execArgv;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--test-reporter=")) names.push(arg.slice("--test-reporter=".length));
    else if (arg === "--test-reporter" && i + 1 < argv.length) names.push(argv[++i]);
    else if (arg.startsWith("--test-reporter-destination="))
      destinationNames.push(arg.slice("--test-reporter-destination=".length));
    else if (arg === "--test-reporter-destination" && i + 1 < argv.length) destinationNames.push(argv[++i]);
  }
  if (names.length === 0) names.push("spec");
  while (destinationNames.length < names.length) destinationNames.push("stdout");

  const { PassThrough, compose } = require("node:stream");
  const { createWriteStream } = require("node:fs");
  const path = require("node:path");
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let reporter = (reporters as Record<string, unknown>)[name];
    if (reporter === undefined) {
      // A custom reporter is a module specifier, like in node.
      try {
        const mod = await import(name.startsWith(".") ? path.resolve(process.cwd(), name) : name);
        reporter = mod.default ?? mod;
      } catch (err) {
        console.error(err);
        process.exitCode = 1;
        continue;
      }
    }
    // node news any constructor-carrying function (utils.js getReportersMap).
    // The own-constructor identity check keeps bundled async generators (whose
    // shared prototype carries an AsyncGeneratorFunction constructor) as-is.
    if (
      (reporter as { prototype?: object })?.prototype &&
      Object.getOwnPropertyDescriptor((reporter as { prototype: object }).prototype, "constructor")?.value === reporter
    ) {
      reporter = new (reporter as new () => unknown)();
    }
    if (typeof reporter !== "function" && !(reporter && typeof (reporter as { pipe?: unknown }).pipe === "function")) {
      // Validate upfront, like node: a plain object must not reach compose(),
      // whose throw would surface as a mid-run unhandled rejection.
      const error = new TypeError(
        `The "Reporter" argument must be a function or a stream. Received ${reporter === undefined ? "undefined" : typeof reporter}`,
      );
      (error as { code?: string }).code = "ERR_INVALID_ARG_TYPE";
      console.error(error);
      process.exitCode = 1;
      continue;
    }
    const destinationName = destinationNames[i];
    const destination =
      destinationName === "stdout"
        ? process.stdout
        : destinationName === "stderr"
          ? process.stderr
          : createWriteStream(path.resolve(process.cwd(), destinationName));
    const endDestination = destination !== process.stdout && destination !== process.stderr;
    const copy = new PassThrough({ objectMode: true });
    stream.pipe(copy);
    promises.push(
      new Promise(resolvePromise => {
        const composed = compose(copy, reporter);
        composed.on("error", (err: Error) => {
          console.error(err?.stack ?? err);
          process.exitCode = 1;
          resolvePromise();
        });
        composed.pipe(destination, { end: endDestination });
        if (endDestination) {
          destination.on("finish", resolvePromise);
          // .pipe() does not back-propagate destination errors to composed;
          // surface them like the composed-error path above.
          destination.on("error", (err: Error) => {
            console.error(err?.stack ?? err);
            process.exitCode = 1;
            resolvePromise();
          });
        } else {
          composed.on("end", resolvePromise);
        }
      }),
    );
  }
}

function bunTestOptions(options: TestOptions) {
  // The node-style timeout is enforced by executeTestNode itself so that a
  // tiny timeout (e.g. 1ms) with a synchronous body still passes like in Node.
  // bun:test's own watchdog measures the whole wrapper, so it is only told
  // about timeouts that extend past its 5s default.
  const { timeout } = options;
  if (timeout === Infinity) {
    // Node's "no timeout" must override bun:test's default (bun saturates it).
    return { timeout };
  }
  if (typeof timeout === "number" && Number.isFinite(timeout)) {
    // Keep bun:test's watchdog at or above both the node-style timeout and
    // bun's default so a lower `--timeout` cannot cut a node timeout short.
    return { timeout: Math.max(timeout, kBunTestDefaultTimeoutMs) };
  }
  return undefined;
}

function currentCollectionParent(): TestNode {
  const node = currentNode();
  if (node !== undefined && !node.isExecutionPhase && node.isSuite) {
    return node;
  }
  return getRootNode();
}

function createTopLevelTestRunner(node: TestNode, fn: TestFn, declaredTodo = false) {
  // bun:test invokes this with a `done` callback because the function declares
  // one parameter.
  return (done: (error?: unknown) => void) => {
    executeTestNode(node, fn).then(
      failure => {
        // A runtime t.skip()/t.todo() overrides bun:test's pass/fail accounting
        // (Node counts these as skip/todo even when the body threw); a declared
        // todo body's failure must reach bun:test's own todo accounting instead.
        if (node.skipped) {
          markCurrentResult(false, done);
        } else if ((node.todoFlag || hasTodoAncestor(node)) && !declaredTodo) {
          // Inherited todo too: a failing test inside a todo suite must not
          // fail the child process (node treats it as todo).
          markCurrentResult(true, done);
        } else {
          done(failure);
          return;
        }
        done(undefined);
      },
      err => done(err),
    );
  };
}

function addTest(
  arg0: unknown,
  arg1: unknown,
  arg2: unknown,
  executionParent: TestNode | undefined,
  mode?: "skip" | "todo" | "only",
): Promise<undefined> {
  const { name, options, fn } = parseTestArgs(arg0, arg1, arg2);
  const { ownTags } = validateTestOptions(options);

  const runningNode = executionParent ?? currentNode();
  if (runningNode !== undefined) {
    if (runningNode.finished) {
      // t.test() escaped its parent: Node fails the late subtest but resolves
      // the promise; don't fall through to bun:test's internal-phase throw.
      return Promise.resolve(undefined);
    }
    if (runningNode.isRunning()) {
      // Subtest of a running test (or of an inline suite created inside one).
      const child = new TestNode(name, runningNode, options, false, true);
      child.ownTags = ownTags;
      if (mode === "skip" || options.skip) {
        reportDirectiveOnlyNode(child, "skip");
        return Promise.resolve(undefined);
      }
      if (mode === "todo") child.todoFlag = true;
      return scheduleSubtest(runningNode, child, fn);
    }
  }

  // Collection phase: register with bun:test.
  const parent = currentCollectionParent();
  const node = new TestNode(name, parent, options, false, false);
  node.ownTags = ownTags;
  if (mode === "only") node.onlyFlag = true;

  // Node checks `skip` before `todo`, so `{ skip: true, todo: true }` is a skip.
  // Execution routing is by truthiness: node runs the body for falsy-but-
  // defined skip/todo ({ skip: '' }) and only reports the directive.
  const effectiveMode =
    mode === "only" ? undefined : (mode ?? (options.skip ? "skip" : options.todo ? "todo" : undefined));

  if (inStandaloneMode()) {
    noteRunChildRegistered(parent);
    if (effectiveMode === "skip") {
      standaloneRegister({ node, fn, isSuite: false, mode: "skip" });
    } else {
      // node runs todo bodies in standalone mode too.
      if (effectiveMode === "todo") node.todoFlag = true;
      standaloneRegister({ node, fn, isSuite: false });
    }
    return Promise.resolve(undefined);
  }
  noteRunChildRegistered(parent);

  const { test } = bunTest();
  const passOptions = bunTestOptions(options);

  if (hasSkippedAncestorSuite(node)) {
    // Declared inside a skipped suite whose callback still ran: node cancels
    // the child without running it, and the cancellation fails the run.
    const cancelledRunner = (done: (error?: unknown) => void) => {
      reportCancelledNode(node);
      done(makeCancelledByParentError());
    };
    test(name, cancelledRunner);
    return Promise.resolve(undefined);
  }

  if (effectiveMode === "todo" || effectiveMode === "skip") {
    // Node runs a todo body, so `t.skip()` inside one still changes the
    // directive it reports. bun:test only runs todo bodies under --todo, so a
    // run() child registers them as ordinary tests and marks the result at the
    // end (what createTopLevelTestRunner already does for a runtime t.todo()).
    if (runChildReporterEnabled && effectiveMode === "todo" && !node.skipped) {
      // The test.todo() spelling carries the directive in `mode`, not in the
      // options, so the node has to be marked for the runner to report it.
      node.todoFlag = true;
      const runner = createTopLevelTestRunner(node, fn);
      if (passOptions !== undefined) test(name, runner, passOptions);
      else test(name, runner);
      return Promise.resolve(undefined);
    }
    if (runChildReporterEnabled) {
      // Report at the node's execution turn so the event stream keeps
      // declaration order (node reports skipped tests with the queued ones).
      const directiveRunner = (done: (error?: unknown) => void) => {
        reportDirectiveOnlyNode(node, effectiveMode);
        markCurrentResult(false, done);
        done(undefined);
      };
      if (passOptions !== undefined) test(name, directiveRunner, passOptions);
      else test(name, directiveRunner);
      return Promise.resolve(undefined);
    }
    // A skipped body never runs — in node either — so nothing would report it.
    // Emit at registration: bun:test collects every test before running any, so
    // there is no later point that still knows the declaration position.
    reportDirectiveOnlyNode(node, effectiveMode);
    const register = effectiveMode === "todo" ? test.todo : test.skip;
    // Node runs todo bodies; bun:test only does so under --todo.
    const body = effectiveMode === "todo" ? createTopLevelTestRunner(node, fn, true) : kDefaultFunction;
    if (passOptions !== undefined) {
      register(name, body, passOptions);
    } else {
      register(name, body);
    }
    return Promise.resolve(undefined);
  }

  // Node's `only` (the option and the test.only()/describe.only() spellings)
  // is a no-op unless --test-only is passed, so it registers an ordinary
  // test/suite; bun:test's only() would skip siblings and is rejected in CI.
  const runner = createTopLevelTestRunner(node, fn);
  if (passOptions !== undefined) {
    test(name, runner, passOptions);
  } else {
    test(name, runner);
  }

  // Resolved eagerly rather than when the runner settles: bun:test never invokes
  // the runner for a test `--test-name-pattern` filters out, so a deferred tied
  // to it would hang an awaiting caller forever. Node resolves those too, and
  // the timing is unobservable under bun:test's collect-then-execute model.
  return Promise.resolve(undefined);
}

function addSuite(
  arg0: unknown,
  arg1: unknown,
  arg2: unknown,
  executionParent?: TestNode,
  mode?: "skip" | "todo" | "only",
): Promise<undefined> {
  const { name, options, fn } = parseTestArgs(arg0, arg1, arg2);
  const { ownTags } = validateTestOptions(options);

  const runningNode = executionParent ?? currentNode();
  if (runningNode !== undefined && runningNode.finished) {
    return Promise.resolve(undefined);
  }
  if (runningNode !== undefined && runningNode.isRunning()) {
    const suite = new TestNode(name, runningNode, options, true, true);
    suite.ownTags = ownTags;
    if (mode === "skip" || options.skip) {
      reportDirectiveOnlyNode(suite, "skip");
      return Promise.resolve(undefined);
    }
    if (mode === "todo") suite.todoFlag = true;
    // The suite's children must run after the parent's previously scheduled
    // subtests AND after the describe callback's own returned promise settles
    // (Node's Suite.run awaits buildPromise before iterating subtests). The
    // callback has not returned yet so its promise does not exist; seed the
    // chain through a gate the callback's settlement opens.
    const gate = Promise.withResolvers<void>();
    suite.subtestChain = runningNode.subtestChain.then(() => gate.promise);
    // Build the suite eagerly (Node also runs describe callbacks immediately),
    // collecting children onto the suite's own subtest chain.
    let build: unknown;
    try {
      build = runWithNode(suite, () => invokeSuiteFn(fn, suite.getSuiteCtx()));
    } catch (err) {
      // The callback threw after possibly registering children: fail the suite
      // but still schedule it so those children are awaited and rolled up.
      recordSuiteFailure(suite, err);
    }
    if (build != null && typeof (build as PromiseLike<unknown>).then === "function") {
      // Attach a handler now: the real await happens when the suite's turn
      // comes, which can be many ticks later (no unhandled rejection).
      (build as Promise<unknown>).then(gate.resolve, gate.resolve);
    } else {
      gate.resolve();
      build = undefined;
    }
    return scheduleSuiteSubtest(runningNode, suite, build);
  }

  const parent = currentCollectionParent();
  const suiteNode = new TestNode(name, parent, options, true, false);
  suiteNode.ownTags = ownTags;
  if (mode === "only") suiteNode.onlyFlag = true;
  noteRunChildRegistered(parent);

  // Node checks `skip` before `todo`, so `{ skip: true, todo: true }` is a skip.
  // Execution routing is by truthiness: node runs the body for falsy-but-
  // defined skip/todo ({ skip: '' }) and only reports the directive.
  const effectiveMode =
    mode === "only" ? undefined : (mode ?? (options.skip ? "skip" : options.todo ? "todo" : undefined));

  if (inStandaloneMode()) {
    if (effectiveMode === "skip") {
      standaloneRegister({ node: suiteNode, fn, isSuite: true, mode: "skip" });
      return Promise.resolve(undefined);
    }
    if (effectiveMode === "todo") suiteNode.todoFlag = true;
    // node runs describe callbacks at declaration; children collected during
    // the callback land in suiteNode.standaloneChildren.
    let build: unknown;
    try {
      build = runWithNode(suiteNode, () => invokeSuiteFn(fn, suiteNode.getSuiteCtx()));
    } catch (err) {
      suiteNode.childrenFailed++;
      suiteNode.error = err;
    }
    const entry: StandaloneEntry = { node: suiteNode, fn, isSuite: true };
    if (build != null && typeof (build as PromiseLike<unknown>).then === "function") {
      const pending = build as Promise<unknown>;
      // Attach a handler now so a rejection before the queue runs it is not
      // reported as unhandled.
      pending.catch(() => {});
      entry.build = pending;
    }
    standaloneRegister(entry);
    return Promise.resolve(undefined);
  }

  const { describe } = bunTest();

  // Node never invokes a skipped suite's callback (it does run a todo one), so
  // the children are never declared and side effects in the body never happen.
  const wrapped =
    effectiveMode === "skip"
      ? kDefaultFunction
      : () => {
          // A todo suite only reaches wrapped() in run-child mode (describe.todo
          // would otherwise skip the body); its failures are advisory and must
          // not reach bun:test's describe-error path, which exits the child
          // nonzero. todoFlag is read here because describe.todo sets it after
          // wrapped() is built.
          const isTodoAdvisory = runChildReporterEnabled && (suiteNode.todoFlag || hasTodoAncestor(suiteNode));
          let built: unknown;
          try {
            built = runWithNode(suiteNode, () => invokeSuiteFn(fn, suiteNode.getSuiteCtx()));
          } catch (err) {
            // Settle so the suite (and every enclosing suite's childrenDone
            // accounting) still completes; bun:test's own describe-error path
            // reports the throw.
            suiteNode.childrenFailed++;
            suiteNode.error = err;
            noteSuiteCollectionSettled(suiteNode);
            if (isTodoAdvisory) return undefined;
            throw err;
          }
          if (built != null && typeof (built as PromiseLike<unknown>).then === "function") {
            return (built as Promise<unknown>).then(
              () => noteSuiteCollectionSettled(suiteNode),
              err => {
                suiteNode.childrenFailed++;
                suiteNode.error = err;
                noteSuiteCollectionSettled(suiteNode);
                if (isTodoAdvisory) return undefined;
                throw err;
              },
            );
          }
          noteSuiteCollectionSettled(suiteNode);
          return built;
        };

  const passOptions = bunTestOptions(options);

  let register: Function = describe;
  if (effectiveMode === "skip") register = describe.skip;
  else if (effectiveMode === "todo") {
    if (runChildReporterEnabled) {
      // node runs a todo suite's children and reports each as todo (the todo
      // directive is inherited). bun:test's describe.todo never executes them,
      // so a run() child registers a plain describe and relies on todoFlag —
      // the children report with todo, and the suite completes through them.
      suiteNode.todoFlag = true;
    } else {
      register = describe.todo;
    }
  }
  if (effectiveMode === "skip" && runChildReporterEnabled) {
    // Report at execution turn so the event stream keeps declaration order.
    suiteNode.suiteReported = true;
    const { test } = bunTest();
    const directiveRunner = (done: (error?: unknown) => void) => {
      reportDirectiveOnlyNode(suiteNode, "skip");
      markCurrentResult(false, done);
      done(undefined);
    };
    if (passOptions !== undefined) test(name, directiveRunner, passOptions);
    else test(name, directiveRunner);
    return Promise.resolve(undefined);
  }
  if (effectiveMode === "skip" || (effectiveMode === "todo" && !runChildReporterEnabled)) {
    // A skipped suite reports as a leaf: its directive event is its completion
    // (its children are never declared at all).
    suiteNode.suiteReported = true;
    reportDirectiveOnlyNode(suiteNode, effectiveMode);
  }

  if (passOptions !== undefined) {
    register(name, wrapped, passOptions);
  } else {
    register(name, wrapped);
  }
  return Promise.resolve(undefined);
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

function test(arg0: unknown, arg1: unknown, arg2: unknown) {
  return addTest(arg0, arg1, arg2, undefined);
}

test.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addTest(arg0, arg1, arg2, undefined, "skip");
};

test.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addTest(arg0, arg1, arg2, undefined, "todo");
};

test.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addTest(arg0, arg1, arg2, undefined, "only");
};

function describe(arg0: unknown, arg1: unknown, arg2: unknown) {
  return addSuite(arg0, arg1, arg2, undefined);
}

describe.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addSuite(arg0, arg1, arg2, undefined, "skip");
};

describe.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addSuite(arg0, arg1, arg2, undefined, "todo");
};

describe.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addSuite(arg0, arg1, arg2, undefined, "only");
};

function hookOwner(): TestNode {
  const node = currentNode();
  if (node !== undefined) {
    return node;
  }
  return getRootNode();
}

function hookArgFor(node: TestNode) {
  return node.isSuite && node.parent !== undefined ? node.getSuiteCtx() : node.getCtx();
}

function before(arg0: unknown, arg1: unknown) {
  const hook = createHook(arg0, arg1);
  const owner = hookOwner();
  // The standalone root check precedes isRunning(): the in-process runner
  // marks the root started, and node runs a root before() SYNCHRONOUSLY at
  // that point (that is how root hooks interleave with file loads), while
  // scheduleImmediateBeforeHook would defer it past the rest of the import.
  if (inStandaloneMode() && owner.parent === undefined) {
    owner.hooks.before.push(hook);
    if (owner.started && !owner.finished) {
      runBeforeHookOnce(hook, owner, hookArgFor(owner)).catch(() => {});
    }
    return;
  }
  if (owner.isRunning()) {
    owner.hooks.before.push(hook);
    if (owner.started && !owner.finished) {
      scheduleImmediateBeforeHook(owner, hook, hookArgFor(owner));
    }
    return;
  }
  if (inStandaloneMode()) {
    owner.hooks.before.push(hook);
    return;
  }
  // A nested describe under a {skip: ''} ancestor still reaches here (addSuite
  // registers it as a plain describe so its body runs), but node cancels the
  // whole subtree without running hooks.
  if (runChildReporterEnabled && (owner.skipped || hasSkippedAncestorSuite(owner))) return;
  const { beforeAll } = bunTest();
  beforeAll((done: (error?: unknown) => void) => {
    Promise.resolve(runHook(hook, owner, hookArgFor(owner))).then(
      () => done(),
      err => {
        // A todo suite's results are advisory in node: its failing before hook
        // must not fail the run (its children still report, as todo).
        if (runChildReporterEnabled && (owner.todoFlag || hasTodoAncestor(owner))) {
          done();
          return;
        }
        done(err ?? new Error("before hook failed"));
      },
    );
  });
}

function after(arg0: unknown, arg1: unknown) {
  const hook = createHook(arg0, arg1);
  const owner = hookOwner();
  if (owner.isRunning()) {
    owner.hooks.after.push(hook);
    return;
  }
  if (inStandaloneMode()) {
    owner.hooks.after.push(hook);
    return;
  }
  if (runChildReporterEnabled && (owner.skipped || hasSkippedAncestorSuite(owner))) return;
  const { afterAll } = bunTest();
  afterAll((done: (error?: unknown) => void) => {
    Promise.resolve(runHook(hook, owner, hookArgFor(owner))).then(
      () => done(),
      err => {
        // A todo suite's results are advisory in node: its failing after hook
        // must not fail the run (mirrors before()'s guard above).
        if (runChildReporterEnabled && (owner.todoFlag || hasTodoAncestor(owner))) {
          done();
          return;
        }
        done(err ?? new Error("after hook failed"));
      },
    );
  });
}

function beforeEach(arg0: unknown, arg1: unknown) {
  hookOwner().hooks.beforeEach.push(createHook(arg0, arg1));
}

function afterEach(arg0: unknown, arg1: unknown) {
  hookOwner().hooks.afterEach.push(createHook(arg0, arg1));
}

function setDefaultSnapshotSerializer(_serializers: unknown[]) {
  throwNotImplemented("setDefaultSnapshotSerializer()", 5090, "Use `bun:test` in the interim.");
}

function setResolveSnapshotPath(_fn: unknown) {
  throwNotImplemented("setResolveSnapshotPath()", 5090, "Use `bun:test` in the interim.");
}

test.describe = describe;
test.suite = describe;
test.test = test;
test.it = test;
test.before = before;
test.after = after;
test.beforeEach = beforeEach;
test.afterEach = afterEach;
test.assert = assert;
test.snapshot = {
  setDefaultSnapshotSerializer,
  setResolveSnapshotPath,
};
test.run = run;
test.mock = mock;
test.getTestContext = getTestContext;

export default test;
