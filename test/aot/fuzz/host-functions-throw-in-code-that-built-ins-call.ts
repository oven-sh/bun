// A function of the host or of the language throws inside a function of the program that a built-in function has called.
//
//   who throws      atob, btoa, structuredClone, postMessage, an aborted signal, a signal that timed out, crypto, performance.measure, WebSocket, a DOMException of the program's own, TextDecoder, URL, Buffer,
//                   queueMicrotask, JSON.parse, a file that is not there, a member of null, an error of the program's own; atob reached through call, apply, bind and map
//   who calls       getters, setters and conversions under Object.assign, defineProperty, entries, a spread, JSON, Math.max, String, a template, `+`; comparators, replacers, mappers and other callbacks; traps of a proxy;
//                   iterators; then() under await; listeners, jobs and timers; constructors of the host that read an options object; functions made from text
//   where caught    in the function that the built-in calls, around the built-in, one function further up, nowhere
//   the call        in tail position, behind another tail call, in an arrow, behind `&&`, not in tail position, as a statement, returned from a finally, leaving through a finally, behind an await
//
// Each scene prints who caught what; with `readsStack` also the own properties and the frames of what was caught.
import type { Random } from "./random";

type Thrower = { name: string; before?: string; call: string };
// `BODY` the statements of the function that is called. `recover` what that function does once it has caught the exception itself. `escapes`: what it throws does not come back to whoever called the built-in.
type Caller = { name: string; run: string; recover?: string; escapes?: true };

export const throwers: Thrower[] = [
  { name: "atob", call: 'atob("***")' },
  { name: "btoa", call: 'btoa("\\u0100")' },
  { name: "clone-of-a-function", call: "structuredClone(function () {})" },
  { name: "clone-of-a-symbol", call: 'structuredClone(Symbol("s"))' },
  {
    name: "aborted-signal",
    before: "const controller = new AbortController();\ncontroller.abort();",
    call: "controller.signal.throwIfAborted()",
  },
  {
    name: "reason-made-in-a-tail-call",
    before: "const controller = new AbortController();\n(function () {\n  return controller.abort();\n})();",
    call: "raise(controller.signal.reason)",
  },
  { name: "signal-born-aborted", call: "AbortSignal.abort().throwIfAborted()" },
  { name: "timeout-below-zero", call: "AbortSignal.timeout(-1)" },
  { name: "signal-that-timed-out", call: "timedOut.throwIfAborted()" },
  { name: "random-values-for-floats", call: "crypto.getRandomValues(new Float32Array(1))" },
  { name: "unknown-digest", call: 'track(crypto.subtle.digest("no", new Uint8Array(1)))' },
  { name: "unknown-key-algorithm", call: 'track(crypto.subtle.importKey("raw", new Uint8Array(1), "no", false, []))' },
  { name: "own-dom-exception", call: 'raise(new DOMException("mine", "DataError"))' },
  { name: "own-dom-exception-made-in-a-tail-call", call: "raise(makeException())" },
  { name: "fatal-decoder", call: 'new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([255]))' },
  { name: "message-with-a-function", call: "port.postMessage(function () {})" },
  { name: "measure-from-no-mark", call: 'performance.measure("m", "no such mark")' },
  { name: "socket-to-no-url", call: 'new WebSocket("no")' },
  { name: "transfer-of-a-number", call: "structuredClone(1, { transfer: [1] })" },
  { name: "url", call: 'new URL("::")' },
  { name: "buffer-below-zero", call: "Buffer.alloc(-1)" },
  { name: "microtask-of-a-number", call: "queueMicrotask(1)" },
  { name: "json", call: 'JSON.parse("{")' },
  { name: "file-that-is-not-there", call: 'readFileSync("/no/such/file")' },
  { name: "member-of-null", call: "nothing.member" },
  { name: "own-type-error", call: 'raise(new TypeError("mine"))' },
  { name: "own-number", call: "raise(7)" },
  { name: "atob-through-reflect-apply", call: 'Reflect.apply(atob, undefined, ["***"])' },
  { name: "atob-through-call", call: 'atob.call(undefined, "***")' },
  { name: "atob-through-bind", call: 'atob.bind(undefined, "***")()' },
  { name: "atob-through-map", call: '["***"].map(atob)' },
  { name: "atob-through-text", call: "new Function(\"return atob('***')\")()" },
];

const endOfIteration = "return { done: true, value: undefined };";
export const callers: Caller[] = [
  { name: "getter-under-assign", run: "Object.assign({}, { get value() { BODY } });" },
  { name: "setter-under-assign", run: "Object.assign({ set value(given) { BODY } }, { value: 1 });" },
  { name: "getter-under-define-property", run: 'Object.defineProperty({}, "p", { get value() { BODY } });' },
  { name: "getter-under-define-properties", run: "Object.defineProperties({}, { p: { get value() { BODY } } });" },
  { name: "getter-under-create", run: "Object.create(null, { p: { get value() { BODY } } });" },
  { name: "getter-under-entries", run: "Object.entries({ get value() { BODY } });" },
  { name: "getter-under-values", run: "Object.values({ get value() { BODY } });" },
  { name: "getter-under-a-spread", run: "kept = { ...{ get value() { BODY } } };" },
  { name: "getter-under-a-rest", run: "const { ...rest } = { get value() { BODY } };\nkept = rest;" },
  { name: "getter-under-reflect-get", run: 'Reflect.get({ get value() { BODY } }, "value");' },
  { name: "setter-under-reflect-set", run: 'Reflect.set({ set value(given) { BODY } }, "value", 1);' },
  { name: "getter-under-stringify", run: "JSON.stringify({ get value() { BODY } });" },
  { name: "to-json", run: "JSON.stringify({ toJSON() { BODY } });" },
  { name: "replacer", run: "JSON.stringify({ a: 1 }, function (key, value) { BODY });" },
  { name: "reviver", run: 'JSON.parse("[1]", function (key, value) { BODY });' },
  { name: "value-of-under-max", run: "Math.max({ valueOf() { BODY } });" },
  { name: "to-string-under-string", run: "String({ toString() { BODY } });" },
  { name: "to-string-under-a-template", run: "kept = `${{ toString() { BODY } }}`;" },
  { name: "value-of-under-plus", run: "kept = 1 + { valueOf() { BODY } };" },
  { name: "value-of-under-less-than", run: "kept = { valueOf() { BODY } } < 1;" },
  { name: "value-of-under-equals", run: "kept = { valueOf() { BODY } } == 1;" },
  { name: "to-primitive-under-number", run: "Number({ [Symbol.toPrimitive]() { BODY } });" },
  { name: "to-primitive-under-date", run: "new Date({ [Symbol.toPrimitive]() { BODY } });" },
  { name: "to-string-under-a-key", run: "kept = {}[{ toString() { BODY } }];" },
  { name: "to-string-under-join", run: "[{ toString() { BODY } }].join();" },
  { name: "to-string-under-parse-int", run: "parseInt({ toString() { BODY } });" },
  { name: "to-string-under-sort", run: '[{ toString() { BODY } }, { toString() { return "a"; } }].sort();' },
  { name: "to-string-under-error", run: "new Error({ toString() { BODY } });" },
  { name: "value-of-under-pad-start", run: '"a".padStart({ valueOf() { BODY } });' },
  { name: "comparator-of-sort", run: "[2, 1].sort(function (a, b) { BODY });" },
  { name: "comparator-of-to-sorted", run: "[2, 1].toSorted(function (a, b) { BODY });" },
  { name: "comparator-of-a-typed-sort", run: "new Int8Array([2, 1]).sort(function (a, b) { BODY });" },
  { name: "callback-of-replace", run: '"a".replace("a", function () { BODY });' },
  { name: "callback-of-replace-by-a-pattern", run: '"a".replace(/a/, function () { BODY });' },
  { name: "callback-of-replace-all", run: '"aa".replaceAll("a", function () { BODY });' },
  { name: "symbol-replace", run: '"a".replace({ [Symbol.replace]() { BODY } }, "");' },
  { name: "symbol-split", run: '"a".split({ [Symbol.split]() { BODY } });' },
  {
    name: "exec-under-replace",
    run: 'const pattern = /a/;\npattern.exec = function () { BODY };\n"a".replace(pattern, "");',
    recover: "return null;",
  },
  { name: "mapper-of-array-from", run: "Array.from([1], function () { BODY });" },
  { name: "callback-of-map", run: "[1].map(function () { BODY });" },
  { name: "callback-of-for-each", run: "[1].forEach(function () { BODY });" },
  { name: "callback-of-filter", run: "[1].filter(function () { BODY });" },
  { name: "callback-of-reduce", run: "[1, 2].reduce(function () { BODY });" },
  { name: "callback-of-find", run: "[1].find(function () { BODY });" },
  { name: "callback-of-flat-map", run: "[1].flatMap(function () { BODY });" },
  { name: "callback-of-a-typed-map", run: "new Int8Array(1).map(function () { BODY });" },
  { name: "callback-of-a-map", run: "new Map([[1, 1]]).forEach(function () { BODY });" },
  { name: "callback-of-a-set", run: "new Set([1]).forEach(function () { BODY });" },
  { name: "callback-of-group-by", run: "Object.groupBy([1], function () { BODY });" },
  { name: "trap-get", run: "kept = new Proxy({}, { get() { BODY } }).member;" },
  { name: "trap-set", run: "new Proxy({}, { set() { BODY } }).member = 1;", recover: "return true;" },
  { name: "trap-has", run: 'kept = "member" in new Proxy({}, { has() { BODY } });', recover: "return false;" },
  { name: "trap-own-keys", run: "Object.keys(new Proxy({}, { ownKeys() { BODY } }));", recover: "return [];" },
  {
    name: "trap-descriptor",
    run: 'Object.getOwnPropertyDescriptor(new Proxy({}, { getOwnPropertyDescriptor() { BODY } }), "member");',
    recover: "return undefined;",
  },
  {
    name: "trap-prototype",
    run: "Object.getPrototypeOf(new Proxy({}, { getPrototypeOf() { BODY } }));",
    recover: "return null;",
  },
  { name: "trap-delete", run: "delete new Proxy({}, { deleteProperty() { BODY } }).member;", recover: "return true;" },
  { name: "trap-apply", run: "new Proxy(function () {}, { apply() { BODY } })();" },
  {
    name: "trap-construct",
    run: "new (new Proxy(function () {}, { construct() { BODY } }))();",
    recover: "return {};",
  },
  { name: "trap-get-under-assign", run: "Object.assign({}, new Proxy({ member: 1 }, { get() { BODY } }));" },
  {
    name: "iterator-under-a-spread",
    run: "kept = [...{ [Symbol.iterator]() { BODY } }];",
    recover: "return [][Symbol.iterator]();",
  },
  {
    name: "next-under-a-spread",
    run: "kept = [...{ [Symbol.iterator]() { return { next() { BODY } }; } }];",
    recover: endOfIteration,
  },
  {
    name: "next-under-a-pattern",
    run: "const [first] = { [Symbol.iterator]() { return { next() { BODY } }; } };\nkept = first;",
    recover: endOfIteration,
  },
  {
    name: "next-under-for-of",
    run: "for (const each of { [Symbol.iterator]() { return { next() { BODY } }; } }) kept = each;",
    recover: endOfIteration,
  },
  {
    name: "return-under-for-of",
    run: "for (const each of { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { BODY } }; } }) break;",
    recover: "return {};",
  },
  {
    name: "next-under-a-new-map",
    run: "new Map({ [Symbol.iterator]() { return { next() { BODY } }; } });",
    recover: endOfIteration,
  },
  {
    name: "next-under-a-new-set",
    run: "new Set({ [Symbol.iterator]() { return { next() { BODY } }; } });",
    recover: endOfIteration,
  },
  {
    name: "next-under-from-entries",
    run: "Object.fromEntries({ [Symbol.iterator]() { return { next() { BODY } }; } });",
    recover: endOfIteration,
  },
  {
    name: "next-under-array-from",
    run: "Array.from({ [Symbol.iterator]() { return { next() { BODY } }; } });",
    recover: endOfIteration,
  },
  {
    name: "next-under-promise-all",
    run: "await Promise.all({ [Symbol.iterator]() { return { next() { BODY } }; } });",
    recover: endOfIteration,
  },
  { name: "generator-under-a-spread", run: "kept = [...(function* () { BODY })()];" },
  { name: "generator-under-yield-star", run: "kept = [...(function* () { yield* (function* () { BODY })(); })()];" },
  {
    name: "async-generator-under-for-await",
    run: "for await (const each of (async function* () { BODY })()) kept = each;",
  },
  { name: "then-under-await", run: "await { then(resolve) { BODY } };", recover: "resolve(0);\nreturn;" },
  {
    name: "then-under-resolve",
    run: "await Promise.resolve({ then(resolve) { BODY } });",
    recover: "resolve(0);\nreturn;",
  },
  { name: "executor", run: "await new Promise(function (resolve) { BODY });", recover: "resolve(0);\nreturn;" },
  { name: "reaction", run: "await Promise.resolve().then(function () { BODY });" },
  { name: "reaction-of-finally", run: "await Promise.resolve().finally(function () { BODY });" },
  { name: "reaction-of-catch", run: "await Promise.reject(1).catch(function () { BODY });" },
  { name: "async-function", run: "await (async function () { BODY })();" },
  { name: "has-instance", run: "kept = 1 instanceof { [Symbol.hasInstance]() { BODY } };" },
  { name: "is-concat-spreadable", run: "[].concat({ get [Symbol.isConcatSpreadable]() { BODY } });" },
  {
    name: "species",
    run: "class List extends Array {\n  static get [Symbol.species]() { BODY }\n}\nnew List(1).map(function () {});",
    recover: "return Array;",
  },
  { name: "raw-under-string-raw", run: "String.raw({ get raw() { BODY } });", recover: "return [];" },
  { name: "reflect-apply", run: "Reflect.apply(function () { BODY }, undefined, []);" },
  { name: "reflect-construct", run: "Reflect.construct(function () { BODY }, []);" },
  { name: "call", run: "(function () { BODY }).call(undefined);" },
  { name: "apply", run: "(function () { BODY }).apply(undefined, []);" },
  { name: "bind", run: "(function () { BODY }).bind(undefined)();" },
  { name: "function-made-from-text", run: 'new Function("callee", "return callee()")(function () { BODY });' },
  {
    name: "function-made-from-text-not-in-tail-position",
    run: 'new Function("callee", "const answer = callee(); return answer")(function () { BODY });',
  },
  { name: "indirect-eval", run: '(0, eval)("(callee) => [callee()]")(function () { BODY });' },
  { name: "dispose-under-using", run: "{\n  using held = { [Symbol.dispose]() { BODY } };\n}" },
  {
    name: "prepare-stack-trace",
    run: 'Error.prepareStackTrace = function () { BODY };\ntry {\n  kept = new Error("asked").stack;\n} finally {\n  Error.prepareStackTrace = undefined;\n}',
  },
  { name: "getter-under-structured-clone", run: "structuredClone({ get value() { BODY } });" },
  { name: "getter-under-post-message", run: "port.postMessage({ get value() { BODY } });" },
  { name: "getter-under-deep-equals", run: "Bun.deepEquals({ get value() { BODY } }, { value: 1 });" },
  { name: "custom-inspect", run: "Bun.inspect({ [Bun.inspect.custom]() { BODY } });" },
  { name: "getter-under-headers", run: "new Headers({ get a() { BODY } });", recover: 'return "a";' },
  { name: "getter-under-search-parameters", run: "new URLSearchParams({ get a() { BODY } });", recover: 'return "a";' },
  { name: "getter-under-response", run: "new Response(null, { get status() { BODY } });", recover: "return 200;" },
  {
    name: "getter-under-request",
    run: 'new Request("http://localhost/", { get method() { BODY } });',
    recover: 'return "GET";',
  },
  { name: "getter-under-event", run: 'new Event("e", { get bubbles() { BODY } });' },
  { name: "to-string-under-blob", run: "new Blob([{ toString() { BODY } }]);", recover: 'return "a";' },
  { name: "to-string-under-atob", run: "atob({ toString() { BODY } });", recover: 'return "";' },
  { name: "to-string-under-dom-exception", run: "new DOMException({ toString() { BODY } });", recover: 'return "a";' },
  { name: "to-string-under-url", run: "new URL({ toString() { BODY } });", recover: 'return "http://localhost/";' },
  {
    name: "to-string-under-text-decoder",
    run: "new TextDecoder({ toString() { BODY } });",
    recover: 'return "utf-8";',
  },
  { name: "value-of-under-buffer-alloc", run: "Buffer.alloc({ valueOf() { BODY } });" },
  {
    name: "to-primitive-under-buffer-from",
    run: "Buffer.from({ [Symbol.toPrimitive]() { BODY } });",
    recover: 'return "a";',
  },
  { name: "start-of-a-stream", run: "new ReadableStream({ start() { BODY } });" },
  { name: "listener-of-an-emitter", run: 'new EventEmitter().on("e", function () { BODY }).emit("e");' },
  {
    name: "listener-of-a-target",
    run: 'const target = new EventTarget();\ntarget.addEventListener("e", function () { BODY });\ntarget.dispatchEvent(new Event("e"));',
    escapes: true,
  },
  {
    name: "listener-of-a-signal",
    run: 'const owner = new AbortController();\nowner.signal.addEventListener("abort", function () { BODY });\nowner.abort();',
    escapes: true,
  },
  { name: "microtask", run: "queueMicrotask(function () { BODY });\nawait turn();", escapes: true },
  { name: "next-tick", run: "process.nextTick(function () { BODY });\nawait turn();", escapes: true },
  {
    name: "timer",
    run: "setTimeout(function () { BODY }, 0);\nawait new Promise(resolve => setTimeout(resolve, 4));",
    escapes: true,
  },
  { name: "immediate", run: "setImmediate(function () { BODY });\nawait turn();\nawait turn();", escapes: true },
];

export const catchers = ["in-the-callback", "around-the-built-in", "one-function-up", "nowhere"] as const;
export const positions = [
  "tail",
  "tail-of-a-tail",
  "tail-of-an-arrow",
  "tail-behind-and",
  "not-tail",
  "statement",
  "returned-from-a-finally",
  "leaves-through-a-finally",
  "behind-an-await",
] as const;

export type Scene = { thrower: number; caller: number; catcher: number; position: number };

export function nameOf({ thrower, caller, catcher, position }: Scene) {
  return `${throwers[thrower].name} ${callers[caller].name} ${catchers[catcher]} ${positions[position]}`;
}

/** What nobody catches ends the program, so such a scene stands last or alone. */
export function endsTheProgram({ caller, catcher }: Scene) {
  return catchers[catcher] === "nowhere" || (!!callers[caller].escapes && catchers[catcher] !== "in-the-callback");
}

function indent(text: string, by: string) {
  return text
    .split("\n")
    .map(line => (line ? by + line : line))
    .join("\n");
}

function throwingStatements(scene: Scene, recover: string) {
  const { before, call } = throwers[scene.thrower];
  const first = before ? before + "\n" : "";
  switch (positions[scene.position]) {
    case "tail":
      return `${first}return ${call};`;
    case "tail-of-a-tail":
      return `function last() {\n${indent(`${first}return ${call};`, "  ")}\n}\nreturn last();`;
    case "tail-of-an-arrow":
      return `${first}return (() => ${call})();`;
    case "tail-behind-and":
      return `${first}return (kept = 1) && ${call};`;
    case "not-tail":
      return `${first}const answer = ${call};\nkept = answer;\nreturn answer;`;
    case "statement":
      return `${first}${call};\n${recover}`;
    case "returned-from-a-finally":
      return `try {\n  kept = 1;\n} finally {\n${indent(`${first}return ${call};`, "  ")}\n}`;
    case "leaves-through-a-finally":
      return `try {\n${indent(`${first}return ${call};`, "  ")}\n} finally {\n  kept = 2;\n}`;
    case "behind-an-await":
      return `const later = (async () => {\n  await 0;\n${indent(`${first}return ${call};`, "  ")}\n})();\n${catchers[scene.catcher] === "nowhere" ? "kept = later;" : "keep(later);"}\n${recover}`;
  }
}

export function textOf(scene: Scene, name: string) {
  const caller = callers[scene.caller];
  const recover = caller.recover ?? "return 0;";
  const throwing = throwingStatements(scene, recover);
  const catcher = catchers[scene.catcher];
  const body =
    catcher === "in-the-callback"
      ? `function inner() {\n${indent(throwing, "  ")}\n}\ntry {\n  return inner();\n} catch (error) {\n  report("the callback", error);\n${indent(recover, "  ")}\n}`
      : throwing;
  const run = caller.run.replace("{ BODY }", () => `{\n${indent(body, "  ")}\n}`);
  const isAsync = /\bawait\b/.test(caller.run);
  const [prefix, wait] = isAsync ? ["async ", "await "] : ["", ""];
  let statements: string;
  if (catcher === "around-the-built-in" || catcher === "in-the-callback")
    statements = `try {\n${indent(run, "  ")}\n  say("  returned");\n} catch (error) {\n  report("around the built-in", error);\n}`;
  else if (catcher === "one-function-up")
    statements = `${prefix}function drive() {\n${indent(run, "  ")}\n}\ntry {\n  ${wait}drive();\n  say("  returned");\n} catch (error) {\n  report("one function up", error);\n}`;
  else statements = `${prefix}function drive() {\n${indent(run, "  ")}\n}\n${wait}drive();\nsay("  returned");`;
  return `${prefix}function ${name}() {\n${indent(statements, "  ")}\n}`;
}

/** With `takesArguments` the command line chooses the scenes that run and how: `first`, `last`, `flags` (`s` reads the stacks, `g` collects behind each scene) and the limit of the stack trace. */
export function programOf(
  scenes: Scene[],
  {
    readsStack = false,
    limit,
    takesArguments = false,
  }: { readsStack?: boolean; limit?: number; takesArguments?: boolean },
) {
  return `import { EventEmitter } from "node:events";
import { readFileSync, writeSync } from "node:fs";

const [first = "0", last = "${scenes.length}", flags = "${readsStack ? "s" : ""}", limit${limit === undefined ? "" : ` = "${limit}"`}] = ${takesArguments ? "process.argv.slice(2)" : "[]"};
if (limit !== undefined) Error.stackTraceLimit = Number(limit);
const readsStack = flags.includes("s");
const collects = flags.includes("g");
const file = /[^ @()\\n]*\\.m?[jt]s/g;
const quoted = / \\(evaluating .*/;
const place = /(file|node:[a-z_\/]+)(:\\d+:\\d+)?/g;
let kept;
let nothing = process.argv.length > 99 ? {} : null;
const pending = [];
const { port1: port, port2: otherPort } = new MessageChannel();
const timedOut = AbortSignal.timeout(1);
await new Promise(resolve => timedOut.addEventListener("abort", resolve));

function say(text) {
  writeSync(1, text + "\\n");
}
function raise(value) {
  throw value;
}
function makeException() {
  return new DOMException("mine", "DataError");
}
function keep(promise) {
  pending.push(Promise.allSettled([promise]));
}
function track(promise) {
  keep(promise);
  throw new RangeError("kept");
}
function turn() {
  return new Promise(resolve => setImmediate(resolve));
}
function report(where, error) {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") return say(\`  \${where}: \${String(error)}\`);
  say(\`  \${where}: \${error.constructor?.name} \${error.name} \${error.code} \${String(error.message).replace(quoted, "")}\`);
  if (!readsStack) return;
  // A place inside a built-in lies in the text of the built-in, which is no matter of the program.
  const stack = String(error.stack).replace(quoted, "").replace(file, "file").replace(/native:\\d+:\\d+/g, "native").split("\\n").join(" < ");
  say(\`  own: \${Object.getOwnPropertyNames(error).join(",")} \${typeof error.line},\${typeof error.column} \${String(error.sourceURL).replace(file, "file")}\`);
  say(\`  frames: \${stack.replace(place, "$1")}\`);
  // A DOMException keeps the places of the text that ran, which is not the text of the file where a file is run from its source.
  if (!(error instanceof DOMException)) say(\`  places: \${stack.replace(/(node:[a-z_\/]+):\\d+:\\d+/g, "$1")}\`);
}

${scenes.map((scene, index) => textOf(scene, `scene${index}`)).join("\n\n")}

const scenes = [
${scenes.map((scene, index) => `  [scene${index}, "${nameOf(scene)}"],`).join("\n")}
];
for (let index = Number(first); index < Number(last); index++) {
  const [scene, name] = scenes[index];
  say(\`#\${index} \${name}\`);
  const answer = scene();
  if (answer) await answer;
  for (const [{ status, reason }] of await Promise.all(pending.splice(0))) if (status === "rejected") report("settled", reason);
  if (collects) Bun.gc(true);
}
port.close();
otherPort.close();
say("end");
`;
}

// TODO: the stacks of these are read too.
const stacksAreNotRead = ["trap-descriptor", "reflect-construct", "generator-under-yield-star"];

/** Twenty-four scenes. With `leavesAnError` one more stands behind them, in which nobody catches what is thrown. */
export function generate(random: Random, leavesAnError = false) {
  const readsStack = random.chance(0.6);
  const draw = () => ({
    thrower: random.below(throwers.length),
    caller: random.below(callers.length),
    catcher: random.below(catchers.length),
    // Five of the nine are tail calls.
    position: random.below(positions.length),
  });
  const isTaken = (scene: Scene) => !readsStack || !stacksAreNotRead.includes(callers[scene.caller].name);
  const scenes: Scene[] = [];
  while (scenes.length < 24) {
    const scene = draw();
    if (!endsTheProgram(scene) && isTaken(scene)) scenes.push(scene);
  }
  while (leavesAnError) {
    const scene = draw();
    if (!endsTheProgram(scene) || !isTaken(scene)) continue;
    scenes.push(scene);
    break;
  }
  return programOf(scenes, { readsStack, limit: readsStack && random.chance(0.3) ? random.between(0, 4) : undefined });
}
