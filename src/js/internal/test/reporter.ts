// Called by test_runner/TestEventReporter.rs. Loads the modules that `bun test --reporter` names and passes each event to them.

const { createRequire } = require("node:module");

const { parse } = JSON;
const PromiseAll = Promise.all.bind(Promise);
const ignore = () => {};

// The hook of each event type: "testEnd" is `onTestEnd`.
const HOOKS: Record<string, string> = {
  __proto__: null,
  runStart: "onRunStart",
  fileStart: "onFileStart",
  fileCollected: "onFileCollected",
  testStart: "onTestStart",
  testEnd: "onTestEnd",
  hookFailure: "onHookFailure",
  unhandledError: "onUnhandledError",
  fileEnd: "onFileEnd",
  runEnd: "onRunEnd",
} as any;

function reporterOf(specifier: string, exports: any) {
  let reporter = exports;
  if ($isObject(exports) && "default" in exports && !$isCallable(exports)) reporter = exports.default;
  if ($isCallable(reporter)) reporter = new reporter();
  if (!$isObject(reporter)) {
    throw new TypeError(
      `The reporter module "${specifier}" must export a reporter object or class as its default export, got ${typeof reporter}`,
    );
  }
  return reporter;
}

// Returns the function that passes an event, as JSON text, to every reporter. Its promise settles once
// the promises that hooks have returned settle, at the end of each file and of the run.
function load(specifiers: string[], cwd: string) {
  const requireFromCwd = createRequire(cwd.endsWith("/") ? cwd : cwd + "/");
  const reporters: object[] = [];
  for (const specifier of specifiers) reporters.push(reporterOf(specifier, requireFromCwd(specifier)));

  let pending: Promise<unknown>[] = [];
  return function dispatch(text: string) {
    const event = parse(text);
    const hook = HOOKS[event.type];
    let error;
    let threw = false;
    for (let i = 0; i < reporters.length; i++) {
      const reporter = reporters[i];
      const fn = reporter[hook];
      if (!$isCallable(fn)) continue;
      try {
        const result = fn.$call(reporter, event);
        if ($isPromise(result)) {
          result.$then(undefined, ignore);
          pending.push(result);
        }
      } catch (e) {
        if (!threw) error = e;
        threw = true;
      }
    }
    if (threw) throw error;
    if (event.type !== "fileEnd" && event.type !== "runEnd") return;
    if (pending.length === 0) return;
    const settling = pending;
    pending = [];
    return PromiseAll(settling);
  };
}

export default load;
