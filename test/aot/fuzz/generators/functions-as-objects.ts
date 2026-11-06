// A function is an object. A compiler may leave out the object of a function that is only ever called, as long as nobody can tell.
// Each case of the first table defines a function, calls it, and looks at it as an object in exactly one way. Alone in its program, nothing else makes the compiler keep the object.
// In the second table the function sits in a field that nobody has read as a value: what is looked at, copied, listed or changed is the object that holds it.
//
//   bun functions-as-objects.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/one-look-<definition>.mjs and <folder>/holder-look-<holder>.mjs.
import { writeCaseFiles, type CaseFile } from "./case-files";

interface Definition {
  name: string;
  definition: string;
  /** How the function is named afterwards. Without it, `LOOK` in the definition stands for the look, at a parameter `f`. */
  reference?: string;
  use?: string;
}

const definitions: Definition[] = [
  { name: "declaration", definition: "function f(a, b) { return n + 1; }", reference: "f", use: "f(1, 2)" },
  { name: "arrow", definition: "const f = (a, b) => n + 1;", reference: "f", use: "f(1, 2)" },
  { name: "named-expression", definition: "const f = function g(a, b) { return n + 1; };", reference: "f", use: "f(1, 2)" },
  { name: "literal-method", definition: "const o = { f(a, b) { return n + 1; } };", reference: "o.f", use: "o.f(1, 2)" },
  { name: "literal-arrow", definition: "const o = { f: (a, b) => n + 1 };", reference: "o.f", use: "o.f(1, 2)" },
  { name: "class-method", definition: "class C { f(a, b) { return n + 1; } } const o = new C();", reference: "o.f", use: "o.f(1, 2)" },
  { name: "static-method", definition: "class C { static f(a, b) { return n + 1; } }", reference: "C.f", use: "C.f(1, 2)" },
  { name: "field-arrow", definition: "class C { f = (a, b) => n + 1; } const o = new C();", reference: "o.f", use: "o.f(1, 2)" },
  { name: "returned", definition: "const make = () => (a, b) => n + 1; const f = make();", reference: "f", use: "f(1, 2)" },
  { name: "made-in-a-loop", definition: "const list = []; for (let i = 0; i < 3; i++) list.push((a, b) => n + i);", reference: "list[1]", use: "list[1](1, 2)" },
  { name: "made-at-every-call", definition: "function outer() { function f(a, b) { return n + 1; } return f; }", reference: "outer()", use: "outer()(1, 2)" },
  { name: "async", definition: "async function f(a, b) { return n + 1; }", reference: "f", use: "await f(1, 2)" },
  { name: "generator", definition: "function* f(a, b) { yield n + 1; }", reference: "f", use: "f(1, 2).next().value" },
  { name: "class", definition: "class f { constructor(a, b) { this.v = n + 1; } }", reference: "f", use: "new f(1, 2).v" },
  { name: "accessor", definition: `const o = { get v() { return n + 1; } }; const f = Object.getOwnPropertyDescriptor(o, "v").get;`, reference: "f", use: "o.v" },
  { name: "factory-literal-arrow", definition: "const make = () => ({ f: (a, b) => n + 1, g: (a, b) => 2 });", reference: "make().f", use: "make().f(1, 2)" },
  { name: "factory-literal-kept", definition: "const make = () => ({ f: (a, b) => n + 1, g: (a, b) => 2 }); const o = make(), other = make(); other.f(1, 2);", reference: "o.f", use: "o.f(1, 2)" },
  { name: "factory-literal-without-captures", definition: "const make = () => ({ f: (a, b) => 2, g: (a, b) => 3 }); const o = make(), other = make(); other.f(1, 2);", reference: "o.f", use: "o.f(1, 2) + n" },
  { name: "arrow-over-its-object", definition: "const o = { v: 1, f: (a, b) => o.v + n };", reference: "o.f", use: "o.f(1, 2)" },
  { name: "module-declaration", definition: "", reference: "top", use: "top(1, 2)" },
  { name: "module-arrow", definition: "", reference: "topArrow", use: "topArrow(1, 2)" },
  { name: "module-class-static", definition: "", reference: "Top.f", use: "Top.f(1, 2)" },
  { name: "parameter-kept", definition: "let kept; const run = f => { kept = f; return f(1, 2); }; const first = run((a, b) => n + 1); clobber(40);", reference: "kept", use: "first" },
  { name: "parameter", definition: "const run = f => [f(1, 2), LOOK];" },
];

interface Look {
  name: string;
  text: string;
}

/** `F` stands for the function. */
const looks: Look[] = [
  { name: "name", text: "F.name" },
  { name: "length", text: "F.length" },
  { name: "typeof", text: "typeof F" },
  { name: "text", text: `F.toString().includes("n +")` },
  { name: "text-by-conversion", text: `(F + "").includes("n +")` },
  { name: "text-in-a-template", text: '`${F}`.includes("n +")' },
  { name: "same", text: "F === F" },
  { name: "loosely-same", text: "F == F" },
  { name: "object-is", text: "Object.is(F, F)" },
  { name: "includes", text: "[F].includes(F)" },
  { name: "index-of", text: "[F].indexOf(F)" },
  { name: "in-a-set", text: "new Set([F]).has(F)" },
  { name: "map-key", text: "new Map([[F, 1]]).get(F)" },
  { name: "weak-map-key", text: "new WeakMap([[F, 1]]).get(F)" },
  { name: "in-a-weak-set", text: "new WeakSet([F]).has(F)" },
  { name: "weak-ref", text: "new WeakRef(F).deref() === F" },
  { name: "prototype", text: "typeof F.prototype" },
  { name: "same-prototype", text: "F.prototype === F.prototype" },
  { name: "constructor-of-prototype", text: "F.prototype?.constructor === F" },
  { name: "names-of-prototype", text: "Object.getOwnPropertyNames(F.prototype ?? {}).join()" },
  { name: "above", text: "Object.getPrototypeOf(F) === Function.prototype" },
  { name: "above-name", text: "Object.getPrototypeOf(F).constructor.name" },
  { name: "is-a-function", text: "F instanceof Function" },
  { name: "is-an-object", text: "F instanceof Object" },
  { name: "constructor", text: "F.constructor.name" },
  { name: "own-keys", text: "Reflect.ownKeys(F).join()" },
  { name: "keys", text: "Object.keys(F).length" },
  { name: "descriptor-of-name", text: `JSON.stringify(Object.getOwnPropertyDescriptor(F, "name"))` },
  { name: "descriptor-of-length", text: `JSON.stringify(Object.getOwnPropertyDescriptor(F, "length"))` },
  { name: "descriptor-of-prototype", text: `JSON.stringify(Object.getOwnPropertyDescriptor(F, "prototype"), (k, v) => typeof v === "object" && k === "value" ? "object" : v)` },
  { name: "name-in", text: `"name" in F` },
  { name: "has-own-prototype", text: `Object.hasOwn(F, "prototype")` },
  { name: "has-own-property", text: `F.hasOwnProperty("length")` },
  { name: "for-in", text: "(() => { const seen = []; for (const k in F) seen.push(k); return seen; })()" },
  { name: "call-in", text: `"call" in F` },
  { name: "absent-name", text: "F.nothing" },
  { name: "computed-name", text: `F[never ? "x" : "name"]` },
  { name: "computed-length", text: `F[never ? "x" : "length"]` },
  { name: "extensible", text: "Object.isExtensible(F)" },
  { name: "is-frozen", text: "Object.isFrozen(F)" },
  { name: "add", text: "(F.extra = 1, F.extra)" },
  { name: "add-and-list", text: "(F.extra = 1, Object.keys(F).join())" },
  { name: "add-twice-read-once", text: "(F.extra = 1, F.extra = 2, F.extra)" },
  { name: "rename", text: `(Object.defineProperty(F, "name", { value: "renamed" }), F.name)` },
  { name: "store-to-name", text: `(() => { try { F.name = "stored"; } catch (e) { return e.name; } return F.name; })()` },
  { name: "delete-name", text: "(delete F.name, F.name)" },
  { name: "delete-length", text: "(delete F.length, F.length)" },
  { name: "delete-prototype", text: "(() => { try { return delete F.prototype; } catch (e) { return e.name; } })()" },
  { name: "replace-prototype", text: "(() => { try { F.prototype = { tag: 1 }; } catch (e) { return e.name; } return F.prototype?.tag; })()" },
  { name: "freeze", text: "(Object.freeze(F), Object.isFrozen(F))" },
  { name: "freeze-and-store", text: "(() => { Object.freeze(F); try { F.extra = 1; } catch (e) { return e.name; } return F.extra; })()" },
  { name: "seal", text: "(Object.seal(F), Object.isSealed(F))" },
  { name: "no-more-properties", text: "(() => { Object.preventExtensions(F); try { F.extra = 1; } catch (e) { return e.name; } return F.extra; })()" },
  { name: "no-prototype-above", text: "(Object.setPrototypeOf(F, null), typeof F.call)" },
  { name: "another-prototype-above", text: "(Object.setPrototypeOf(F, { tag: 1 }), F.tag)" },
  { name: "assign", text: "Object.assign(F, { a: 1 }).a" },
  { name: "accessor-on-it", text: `(Object.defineProperty(F, "got", { get() { return this === F; } }), F.got)` },
  { name: "symbol-on-it", text: `(F[Symbol.for("s")] = 1, Object.getOwnPropertySymbols(F).length)` },
  { name: "element-on-it", text: "(F[0] = 1, F[0])" },
  { name: "call", text: "SHOW(F.call(null, 1, 2))" },
  { name: "apply", text: "SHOW(F.apply(null, [1, 2]))" },
  { name: "bind", text: "SHOW(F.bind(null, 1)(2))" },
  { name: "bound-name", text: "F.bind(null).name" },
  { name: "bound-length", text: "F.bind(null, 1).length" },
  { name: "reflect-apply", text: "SHOW(Reflect.apply(F, null, [1, 2]))" },
  { name: "call-of-call", text: "SHOW(Function.prototype.call.call(F, null))" },
  { name: "taken-call", text: "(() => { const { call } = F; return SHOW(call.call(F, null)); })()" },
  { name: "new", text: "typeof new F()" },
  { name: "reflect-construct", text: "typeof Reflect.construct(F, [])" },
  { name: "as-new-target", text: "Object.getPrototypeOf(Reflect.construct(Object, [], F)) === F.prototype" },
  { name: "extended", text: "(() => { class X extends F {} return typeof new X(); })()" },
  { name: "optional-call", text: "SHOW(F?.(1))" },
  { name: "tag", text: "SHOW(F`t`)" },
  { name: "comma-call", text: "SHOW((0, F)(1))" },
  { name: "spread-call", text: "SHOW(F(...[1, 2]))" },
  { name: "instance-of-it", text: "({}) instanceof F" },
  { name: "has-instance", text: "typeof F[Symbol.hasInstance]" },
  { name: "caller", text: "F.caller" },
  { name: "arguments", text: "F.arguments" },
  { name: "map", text: "SHOW([1].map(F)[0])" },
  { name: "sort", text: "[2, 1].sort(F).length" },
  { name: "then", text: "SHOW(await Promise.resolve(1).then(F))" },
  { name: "timer", text: `await new Promise(done => { setTimeout(F); setTimeout(done, 1, "waited"); })` },
  { name: "microtask", text: `(queueMicrotask(F), await null, "waited")` },
  { name: "replace", text: `typeof "a".replace("a", F)` },
  { name: "array-from", text: "SHOW(Array.from([1], F)[0])" },
  { name: "executor", text: "typeof new Promise(F)" },
  { name: "proxy-of-it", text: "SHOW(new Proxy(F, {})(1, 2))" },
  { name: "proxy-trap", text: "SHOW(new Proxy({}, { get: F }).x)" },
  { name: "as-getter", text: `SHOW(Object.defineProperty({}, "x", { get: F }).x)` },
  { name: "as-value-of", text: "typeof (({ valueOf: F }) + 1)" },
  { name: "as-to-string", text: `typeof (({ toString: F }) + "")` },
  { name: "as-to-json", text: "typeof JSON.stringify({ toJSON: F })" },
  { name: "as-iterator-method", text: "(() => { try { return [...{ [Symbol.iterator]: F }].length; } catch (e) { return e.name; } })()" },
  { name: "listener", text: `(() => { const target = new EventTarget(); target.addEventListener("x", F); return target.dispatchEvent(new Event("x")); })()` },
  { name: "listener-removed", text: `(() => { const target = new EventTarget(); let ran = 0; const g = F; target.addEventListener("x", g); target.removeEventListener("x", F); return target.dispatchEvent(new Event("x")); })()` },
  { name: "next-tick", text: `(process.nextTick(F), await new Promise(done => setImmediate(done)), "waited")` },
  { name: "registry", text: "typeof new FinalizationRegistry(F)" },
  { name: "reviver", text: `typeof JSON.parse("1", F)` },
  { name: "replacer", text: "typeof JSON.stringify(1, F)" },
  { name: "serialized", text: "JSON.stringify({ g: F })" },
  { name: "serialized-in-a-list", text: "JSON.stringify([F])" },
  { name: "serialized-alone", text: "JSON.stringify(F)" },
  { name: "cloned", text: "structuredClone(F)" },
  { name: "cloned-inside", text: "structuredClone({ a: 1, g: F })" },
  { name: "inspected", text: "Bun.inspect(F)" },
  { name: "inspected-inside", text: "Bun.inspect({ g: F })" },
  { name: "awaited", text: "(await F) === F" },
  { name: "resolved", text: "await Promise.resolve(F).then(v => v === F)" },
  { name: "returned-by-async", text: "(await (async () => F)()) === F" },
  { name: "then-of-it", text: "F.then" },
  { name: "yielded", text: "(function* () { yield F; })().next().value === F" },
  { name: "number", text: "+F" },
  { name: "not", text: "!F" },
  { name: "less", text: "F < 1" },
  { name: "is-nan", text: "isNaN(F)" },
  { name: "boolean", text: "Boolean(F)" },
  { name: "object-of-it", text: "Object(F) === F" },
  { name: "nullish", text: "(F ?? 1) === F" },
  { name: "void", text: "void F" },
  { name: "spread-list", text: "[...[F]][0] === F" },
  { name: "spread-object", text: "({ ...{ g: F } }).g === F" },
  { name: "values", text: "Object.values({ g: F })[0] === F" },
  { name: "entries", text: "Object.entries({ g: F })[0][1] === F" },
  { name: "assigned", text: "Object.assign({}, { g: F }).g === F" },
  { name: "flat", text: "[[F]].flat()[0] === F" },
  { name: "concat", text: "[F].concat()[0] === F" },
  { name: "array-of", text: "Array.of(F)[0] === F" },
  { name: "slice", text: "[F].slice()[0] === F" },
  { name: "destructured", text: "(({ g }) => g === F)({ g: F })" },
  { name: "from-entries", text: `Object.fromEntries([["g", F]]).g === F` },
  { name: "find", text: "[F].find(() => true) === F" },
  { name: "through-native-code", text: `new CustomEvent("x", { detail: F }).detail === F` },
  { name: "through-text", text: `(globalThis.handed = F, (0, eval)("handed") === F)` },
  { name: "name-seen-by-text", text: `(globalThis.handed = F, (0, eval)("handed.name + handed.length"))` },
  { name: "global", text: "(globalThis.kept = F, typeof kept)" },
  { name: "thrown", text: "(() => { try { throw F; } catch (e) { return e === F; } })()" },
  { name: "is-array", text: "Array.isArray(F)" },
  { name: "tag-string", text: "Object.prototype.toString.call(F)" },
  { name: "is-callable-by-every", text: `[F].every(g => typeof g === "function")` },
];

/** Each defines `o`, with the function in `o.f`. */
const holders: { name: string; definition: string }[] = [
  { name: "literal-arrow", definition: "const o = { v: 1, f: (a, b) => n + 1, w: 2 };" },
  { name: "literal-method", definition: "const o = { v: 1, f(a, b) { return n + this.v; }, w: 2 };" },
  { name: "arrow-over-its-object", definition: "const o = { v: 1, f: (a, b) => o.v + n, w: 2 };" },
  { name: "arrow-without-captures", definition: "const o = { v: 1, f: (a, b) => 2, w: 2 };" },
  { name: "factory", definition: "const make = () => { const o = { v: 1, f: (a, b) => o.v + n, w: 2 }; return o; }; const o = make(), other = make();" },
  { name: "factory-without-captures", definition: "const make = () => ({ v: 1, f: (a, b) => 2, w: 2 }); const o = make(), other = make();" },
  { name: "field-arrow", definition: "class C { v = 1; f = (a, b) => this.v + n; w = 2; } const o = new C(), other = new C();" },
  { name: "constructor-store", definition: "class C { constructor() { this.v = 1; this.f = (a, b) => this.v + n; this.w = 2; } } const o = new C(), other = new C();" },
];

const holderLooks: Look[] = [
  { name: "spread-same", text: "({ ...o }).f === o.f" },
  { name: "assign-same", text: "Object.assign({}, o).f === o.f" },
  { name: "two-copies-same", text: "(() => { const a = { ...o }, b = { ...o }; return a.f === b.f; })()" },
  { name: "copy-then-read-source", text: "(() => { const a = { ...o }; const mine = a.f; return mine === o.f; })()" },
  { name: "copy-called", text: "({ ...o }).f(1, 2)" },
  { name: "copy-changed-and-called", text: "(() => { const c = { ...o }; c.v = 9; return [c.f(1, 2), o.f(1, 2)]; })()" },
  { name: "source-changed-and-copy-called", text: "(() => { const c = { ...o }; o.v = 9; return [c.f(1, 2), o.f(1, 2)]; })()" },
  { name: "values", text: "Object.values(o).includes(o.f)" },
  { name: "entries", text: "Object.entries(o).some(([k, v]) => v === o.f)" },
  { name: "destructured", text: "(({ f }) => f === o.f)(o)" },
  { name: "rest", text: "(() => { const { v, ...rest } = o; return [rest.f === o.f, Object.keys(rest).join()]; })()" },
  { name: "cloned", text: "structuredClone(o)" },
  { name: "serialized", text: "JSON.stringify(o)" },
  { name: "inspected", text: "Bun.inspect(o)" },
  { name: "keys", text: "Object.keys(o).join()" },
  { name: "own-names", text: "Reflect.ownKeys(o).join()" },
  { name: "for-in", text: "(() => { const seen = []; for (const k in o) seen.push(k + typeof o[k]); return seen; })()" },
  { name: "descriptor", text: `Object.getOwnPropertyDescriptor(o, "f").value === o.f` },
  { name: "descriptor-shape", text: `JSON.stringify(Object.getOwnPropertyDescriptor(o, "f"))` },
  { name: "descriptors", text: "Object.getOwnPropertyDescriptors(o).f.value === o.f" },
  { name: "reflect-get", text: `Reflect.get(o, "f") === o.f` },
  { name: "computed", text: `o[never ? "x" : "f"] === o.f` },
  { name: "computed-call", text: `o[never ? "x" : "f"](1, 2)` },
  { name: "inherited", text: "Object.create(o).f === o.f" },
  { name: "inherited-call", text: "Object.create(o).f(1, 2)" },
  { name: "twice", text: "o.f === o.f" },
  { name: "typeof", text: "typeof o.f" },
  { name: "name", text: "o.f.name" },
  { name: "has", text: `["f" in o, Object.hasOwn(o, "f"), o.hasOwnProperty("f"), o.propertyIsEnumerable("f")]` },
  { name: "frozen", text: "(Object.freeze(o), [o.f === o.f, Object.isFrozen(o), o.f(1, 2)])" },
  { name: "sealed", text: "(Object.seal(o), [o.f(1, 2), Object.isSealed(o)])" },
  { name: "deleted", text: `(delete o.f, [typeof o.f, "f" in o, Object.keys(o).join()])` },
  { name: "deleted-and-stored-again", text: "(() => { const saved = o.f; delete o.f; o.f = saved; return [Object.keys(o).join(), o.f(1, 2), o.f === saved]; })()" },
  { name: "replaced-by-a-number", text: "(o.f = 1, [o.f, typeof o.f])" },
  { name: "replaced-by-a-function", text: `(() => { const g = () => "other"; o.f = g; return [o.f(), o.f === g]; })()` },
  { name: "taken-then-cleared", text: "(() => { const g = o.f; o.f = null; return [g(1, 2), o.f]; })()" },
  { name: "hidden", text: `(Object.defineProperty(o, "f", { enumerable: false }), [Object.keys(o).join(), o.f(1, 2), JSON.stringify({ ...o })])` },
  { name: "made-an-accessor", text: `(Object.defineProperty(o, "f", { get() { return 5; } }), o.f)` },
  { name: "made-read-only", text: `(() => { Object.defineProperty(o, "f", { writable: false }); try { o.f = 1; } catch (e) { return [e.name, typeof o.f]; } return typeof o.f; })()` },
  { name: "map-of-entries", text: `new Map(Object.entries(o)).get("f") === o.f` },
  { name: "mapped", text: "[o].map(each => each.f)[0] === o.f" },
  { name: "through-native-code", text: `new CustomEvent("x", { detail: o }).detail.f === o.f` },
  { name: "through-text", text: `(globalThis.handed = o, (0, eval)("handed.f") === o.f)` },
  { name: "called-by-text", text: `(globalThis.handed = o, (0, eval)("handed.f(1, 2)"))` },
  { name: "changed-by-text", text: `(globalThis.handed = o, (0, eval)("handed.f = () => 7"), o.f(1, 2))` },
  { name: "no-prototype", text: "(Object.setPrototypeOf(o, null), o.f(1, 2))" },
  { name: "called-on-another", text: "o.f.call({ v: 50 }, 1, 2)" },
  { name: "moved-to-another", text: "(() => { const c = { v: 50, f: o.f }; return c.f(1, 2); })()" },
  { name: "property-on-it", text: "(o.f.extra = 1, [o.f.extra, ({ ...o }).f.extra])" },
  { name: "weak-key", text: "(() => { const seen = new WeakSet([o.f]); return seen.has(({ ...o }).f); })()" },
  { name: "not-the-other-object's", text: `typeof other === "undefined" ? "one object" : [o.f === other.f, (o.f.extra = 1, other.f.extra)]` },
];

const head = `// A function is an object: whoever looks at it as one finds what plain JavaScript shows, also when the rest of the program only ever calls it.
const never = process.argv.length > 99;
const SHOW = v => v && typeof v === "object" ? (typeof v.then === "function" ? "promise" : typeof v.next === "function" ? "generator" : "object") : v;
const show = v => JSON.stringify(v, (key, each) => each === undefined ? "undefined" : typeof each === "function" ? "function" : typeof each === "number" && each !== each ? "NaN" : each);
let moduleNumber = 1;
function top(a, b) { return moduleNumber + 1; }
const topArrow = (a, b) => moduleNumber + 1;
class Top { static f(a, b) { return moduleNumber + 1; } }
const clobber = depth => depth ? clobber(depth - 1) + 1 : 0;
async function t(name, f) { let r; try { r = show(await f()); } catch (e) { r = "threw " + e.name; } console.log(name, r); }
`;

const caseOf = (name: string, body: string) => ({ name, line: `await t("${name}", async () => { let n = 1; ${body} });` });
const at = (text: string, reference: string) => text.replace(/\bF\b/g, () => reference);

export const looksAtFunctions = (): CaseFile[] =>
  definitions.map(({ name, definition, reference, use }) => ({
    name: `one-look-${name}.mjs`,
    head,
    cases: looks.flatMap(look => {
      if (reference) return caseOf(`${name} ${look.name}`, `${definition} const used = ${use}; return [used, ${at(look.text, reference)}];`);
      // The function that takes the parameter is not async.
      return look.text.includes("await") ? [] : caseOf(`${name} ${look.name}`, `${definition.replace("LOOK", () => at(look.text, "f"))} return run((a, b) => n + 1);`);
    }),
  }));

export const looksAtHolders = (): CaseFile[] =>
  holders.map(({ name, definition }) => ({
    name: `holder-look-${name}.mjs`,
    head,
    cases: holderLooks.flatMap(look =>
      ["called-first", "never-called"].map(called =>
        caseOf(
          `${name} ${look.name} ${called}`,
          `${definition}${look.text.includes("other") && !definition.includes("other") ? " const other = undefined;" : ""} const used = ${called === "called-first" ? "o.f(1, 2)" : "0"}; return [used, ${look.text}];`,
        ),
      ),
    ),
  }));

if (import.meta.main) writeCaseFiles([...looksAtFunctions(), ...looksAtHolders()]);
