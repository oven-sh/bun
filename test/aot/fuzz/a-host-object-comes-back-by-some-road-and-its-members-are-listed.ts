// A table, no seeds: an object of the platform (`process`, `Bun`, `console`, a `node:` module) is handed to something and comes back out of it, and then its members are listed, none of them by name.
//
//   the object x the road by which it comes back x the way its members are listed
//
// One case to a program: a program that lists the members of the object in a second way would answer for the first as well.
type Named = { name: string; text: string };

/** `text` is the object. `imports` stands at the top of the file. */
const hosts: readonly (Named & { imports?: string })[] = [
  { name: "process", text: "process" },
  { name: "Bun", text: "Bun" },
  { name: "console", text: "console" },
  ...["fs", "path", "os", "util", "events", "buffer", "child_process", "crypto", "http", "stream", "url", "zlib", "timers", "assert", "module", "worker_threads", "perf_hooks", "readline", "tty", "net", "dns", "v8", "vm", "string_decoder", "querystring"].map(name => ({ name: `node:${name}`, text: "host", imports: `import host from "node:${name}";` })), // prettier-ignore
];

/** `H` is the object; the value of `text` is the same object. What `declares` stands in front. */
const roads: readonly (Named & { declares?: string })[] = [
  { name: "itself", text: "H" },
  { name: "a variable", declares: "let kept = H;", text: "kept" },
  { name: "a function", declares: "function same(x) { return x; }", text: "same(H)" },
  {
    name: "a function that nobody can follow",
    declares: 'const unknown = new Function("x", "return x");',
    text: "unknown(H)",
  },
  { name: "a closure", declares: "const later = (x => () => x)(H);", text: "later()" },
  { name: "a field of a literal", text: "({ held: H }).held" },
  {
    name: "a field under a key made at run time",
    declares: 'const key = ["he", "ld"].join("");',
    text: "({ held: H })[key]",
  },
  {
    name: "a field of an instance",
    declares: "class Holder { constructor(x) { this.held = x; } }",
    text: "new Holder(H).held",
  },
  { name: "a private field", declares: "class Holder { #held; constructor(x) { this.#held = x; } get() { return this.#held; } }", text: "new Holder(H).get()" }, // prettier-ignore
  { name: "a getter", text: "({ get held() { return H; } }).held" },
  { name: "a destructured field", declares: "const { held } = { held: H };", text: "held" },
  { name: "a default of a parameter", declares: "function given(x = H) { return x; }", text: "given()" },
  {
    name: "the rest of the arguments",
    declares: "function last(...all) { return all[all.length - 1]; }",
    text: "last(1, H)",
  },
  { name: "arguments", declares: "function first() { return arguments[0]; }", text: "first(H)" },
  { name: "this", declares: "function self() { return this; }", text: "self.call(H)" },
  { name: "a bound function", declares: "function self() { return this; }", text: "self.bind(H)()" },
  { name: "Reflect.apply", declares: "function same(x) { return x; }", text: "Reflect.apply(same, undefined, [H])" },
  { name: "an element of a list", text: "[H][0]" },
  { name: "at", text: "[H].at(-1)" },
  { name: "pop", text: "[H].pop()" },
  { name: "find", text: "[1, H].find(x => x !== 1)" },
  { name: "a spread list", text: "[...[H]][0]" },
  { name: "concat", text: "[].concat([H])[0]" },
  { name: "flat", text: "[[H]].flat()[0]" },
  { name: "slice", text: "[H].slice()[0]" },
  { name: "toSorted", text: "[H].toSorted()[0]" },
  { name: "with", text: "[0].with(0, H)[0]" },
  { name: "map", text: "[0].map(() => H)[0]" },
  { name: "reduce", text: "[H].reduce((_, x) => x, 0)" },
  { name: "Array.from", text: "Array.from([H])[0]" },
  { name: "Array.of", text: "Array.of(H)[0]" },
  { name: "a for-of loop", declares: "let seen; for (const x of [H]) seen = x;", text: "seen" },
  { name: "a callback of forEach", declares: "let seen; [H].forEach(x => { seen = x; });", text: "seen" },
  { name: "the values of a list", text: "[H].values().next().value" },
  { name: "an iterator helper", text: "[H].values().map(x => x).toArray()[0]" },
  { name: "a generator", declares: "function* yields(x) { yield x; }", text: "yields(H).next().value" },
  { name: "what a generator is sent", declares: "function* takes() { return yield; } const running = takes(); running.next();", text: "running.next(H).value" }, // prettier-ignore
  { name: "a Map's value", text: "new Map([[1, H]]).get(1)" },
  { name: "a Map's key", text: "[...new Map([[H, 1]]).keys()][0]" },
  { name: "a Set", text: "[...new Set([H])][0]" },
  { name: "a WeakMap's value", declares: "const token = {};", text: "new WeakMap([[token, H]]).get(token)" },
  { name: "a WeakRef", text: "new WeakRef(H).deref()" },
  { name: "Object.values", text: "Object.values({ held: H })[0]" },
  { name: "Object.entries", text: "Object.entries({ held: H })[0][1]" },
  { name: "Object.fromEntries", text: 'Object.fromEntries([["held", H]]).held' },
  { name: "Object.assign", text: "Object.assign({}, { held: H }).held" },
  { name: "a spread literal", text: "({ ...{ held: H } }).held" },
  { name: "Object.groupBy", text: 'Object.groupBy([H], () => "held").held[0]' },
  { name: "a descriptor", text: 'Object.getOwnPropertyDescriptor({ held: H }, "held").value' },
  { name: "Object.defineProperty", text: 'Object.defineProperty({}, "held", { value: H }).held' },
  { name: "Reflect.get", text: 'Reflect.get({ held: H }, "held")' },
  { name: "the prototype", text: "Object.getPrototypeOf(Object.create(H))" },
  { name: "a proxy's handler", text: "new Proxy({}, { get: () => H }).anything" },
  { name: "a proxy's target", text: "new Proxy({ held: H }, {}).held" },
  {
    name: "a thrown value",
    declares: "let caught; try { throw H; } catch (thrown) { caught = thrown; }",
    text: "caught",
  },
  { name: "the cause of an error", text: 'new Error("x", { cause: H }).cause' },
  { name: "the errors of an AggregateError", text: "new AggregateError([H]).errors[0]" },
  { name: "the error of a SuppressedError", text: "new SuppressedError(H, 1).error" },
  { name: "what a SuppressedError suppressed", text: "new SuppressedError(1, H).suppressed" },
  { name: "a tagged template", declares: "function tag(_, x) { return x; }", text: "tag`${H}`" },
  { name: "a conditional", declares: "const often = Date.now() > 0;", text: "(often ? H : {})" },
  { name: "either of two", text: "(null ?? H)" },
  { name: "a comma", text: "(0, H)" },
  { name: "await", text: "await H" },
  { name: "Promise.resolve", text: "await Promise.resolve(H)" },
  { name: "then", text: "await Promise.resolve(1).then(() => H)" },
  { name: "a catch handler", text: "await Promise.reject(H).catch(reason => reason)" },
  { name: "finally", text: "await Promise.resolve(H).finally(() => {})" },
  { name: "Promise.all", text: "(await Promise.all([H]))[0]" },
  { name: "Promise.allSettled, fulfilled", text: "(await Promise.allSettled([H]))[0].value" },
  { name: "Promise.allSettled, rejected", text: "(await Promise.allSettled([Promise.reject(H)]))[0].reason" },
  { name: "Promise.race", text: "await Promise.race([H])" },
  { name: "Promise.any", text: "await Promise.any([H])" },
  { name: "the errors of Promise.any", text: "await Promise.any([Promise.reject(H)]).catch(error => error.errors[0])" },
  {
    name: "Promise.withResolvers",
    declares: "const made = Promise.withResolvers(); made.resolve(H);",
    text: "await made.promise",
  },
  { name: "Promise.try", text: "await Promise.try(() => H)" },
  { name: "a new Promise", text: "await new Promise(resolve => resolve(H))" },
  { name: "an async function", declares: "async function soon(x) { return x; }", text: "await soon(H)" },
  {
    name: "an async generator",
    declares: "async function* yields(x) { yield x; }",
    text: "(await yields(H).next()).value",
  },
  { name: "Array.fromAsync", text: "(await Array.fromAsync([H]))[0]" },
  { name: "a for-await loop", declares: "let seen; for await (const x of [H]) seen = x;", text: "seen" },
  { name: "a timer's argument", text: "await new Promise(resolve => setTimeout(resolve, 0, H))" },
  { name: "queueMicrotask", text: "await new Promise(resolve => queueMicrotask(() => resolve(H)))" },
  { name: "process.nextTick's argument", text: "await new Promise(resolve => process.nextTick(resolve, H))" },
  { name: "an event's argument", declares: 'import { EventEmitter } from "node:events";\nconst emitter = new EventEmitter(); let heard; emitter.on("x", x => { heard = x; }); emitter.emit("x", H);', text: "heard" }, // prettier-ignore
  { name: "an event's detail", declares: 'const target = new EventTarget(); let heard; target.addEventListener("x", event => { heard = event.detail; }); target.dispatchEvent(new CustomEvent("x", { detail: H }));', text: "heard" }, // prettier-ignore
  { name: "a member of globalThis", declares: "globalThis.heldForLater = H;", text: "globalThis.heldForLater" },
  { name: "a symbol's member", declares: 'const mark = Symbol("held");', text: "({ [mark]: H })[mark]" },
  { name: "a sort's comparator", declares: "let seen; [H, H].sort((a, b) => ((seen = a), 0));", text: "seen" },
  { name: "a replacer's this", declares: "let seen; JSON.stringify({ held: 1 }, function (key, value) { seen ??= H; return value; });", text: "seen" }, // prettier-ignore
  {
    name: "valueOf",
    declares: "let seen; const asked = { valueOf() { seen = H; return 1; } }; void +asked;",
    text: "seen",
  },
];

/** `x` is the object that came back. Each gives a text of names and kinds. */
const listed: readonly Named[] = [
  { name: "Object.entries", text: 'Object.entries(x).map(([key, value]) => key + ":" + typeof value).join()' },
  { name: "Object.keys and an index", text: 'Object.keys(x).map(key => key + ":" + typeof x[key]).join()' },
  { name: "Object.values", text: "Object.values(x).map(value => typeof value).join()" },
  { name: "a for-in loop", text: '(() => { let text = ""; for (const key in x) if (Object.hasOwn(x, key)) text += key + ":" + typeof x[key] + ","; return text; })()' }, // prettier-ignore
  {
    name: "a spread literal",
    text: '(copy => Object.keys(copy).map(key => key + ":" + typeof copy[key]).join())({ ...x })',
  },
  { name: "Object.assign", text: '(copy => Object.keys(copy).map(key => key + ":" + typeof copy[key]).join())(Object.assign({}, x))' }, // prettier-ignore
  { name: "the descriptors", text: 'Object.entries(Object.getOwnPropertyDescriptors(x)).filter(([, own]) => own.enumerable).map(([key, own]) => key + ":" + ("value" in own ? typeof own.value : "accessor")).join()' }, // prettier-ignore
  { name: "the descriptors, each getter called", text: 'Object.entries(Object.getOwnPropertyDescriptors(x)).filter(([, own]) => own.enumerable).map(([key, own]) => key + ":" + typeof ("value" in own ? own.value : own.get?.call(x))).join()' }, // prettier-ignore
  {
    name: "a rest pattern",
    text: '(({ ...rest }) => Object.keys(rest).map(key => key + ":" + typeof rest[key]).join())(x)',
  },
  { name: "Reflect.ownKeys and Reflect.get", text: 'Reflect.ownKeys(x).filter(key => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(x, key)).map(key => key + ":" + typeof Reflect.get(x, key)).join()' }, // prettier-ignore
];

const crossed = hosts.flatMap(host => roads.flatMap(road => listed.map(lists => ({ host, road, lists }))));

export const programs = crossed.length;

export function programOf(index: number): { file: string; text: string } {
  // Neighbors in the table differ in the way of listing alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
  const { host, road, lists } = crossed[(index * 7919) % crossed.length];
  const label = `${host.name} | ${road.name} | ${lists.name}`;
  return {
    file: "main.mjs",
    text: `${host.imports ? host.imports + "\n" : ""}${road.declares ? road.declares.replaceAll("H", host.text) + "\n" : ""}const x = ${road.text.replaceAll("H", host.text)};
console.log(${JSON.stringify(label)} + ": " + ${lists.text});
process.exit(0);
`,
  };
}
