// An instance of a class with two fields of type number, and one way in which a built-in, a protocol or a callback changes it, its class or what lies above it, or makes another object that passes for one.
// Typed functions read, call and store through a parameter of the class's type before and after, on that object and on fresh ones.
const head = `class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } sum(): number { return this.x + this.y; } }
function use(p: Point): string { let s: string; try { s = String(p.sum()); } catch (e) { s = "throws " + (e as Error).name; } return typeof p.x + ":" + String(p.x) + ":" + typeof p.y + ":" + s + ":" + Object.getOwnPropertyNames(p).join(",") + ":" + (p instanceof Point); }
function set(p: Point, v: number): string { try { p.x = v; return "stored " + String(p.x); } catch (e) { return "throws " + (e as Error).name; } }
const p = new Point(1, 2);
console.log(use(p));
`;
const tail = `
console.log(use(p), set(p, 41), use(p));
for (let i = 0; i < 3; i++) { const n = new Point(i, i); console.log(use(n), set(n, 5), use(n)); }
export {};
`;
const another = (made: string) => `const q = ${made} as any as Point; console.log(use(q), set(q, 3), use(q));`;

export const changes: Record<string, string> = {
  "Object.assign from parsed data": `Object.assign(p, JSON.parse('{"x":"s"}'));`,
  "Object.assign from a literal": `Object.assign(p, { x: "s" } as any);`,
  "Reflect.set": `Reflect.set(p, "x", "s");`,
  "a getter by Object.defineProperty": `Object.defineProperty(p, "x", { get() { return "g"; }, configurable: true });`,
  "Object.defineProperties": `Object.defineProperties(p, { x: { value: "s" } });`,
  "__defineGetter__": `(p as any).__defineGetter__("x", () => "g");`,
  "the setter of __proto__ called": `(Object.prototype as any).__lookupSetter__("__proto__").call(p, { sum() { return "other"; } });`,
  "Reflect.set of __proto__": `Reflect.set(p, "__proto__", { sum() { return "other"; } });`,
  "Reflect.setPrototypeOf": `Reflect.setPrototypeOf(p, { sum() { return "other"; } });`,
  "Error.captureStackTrace": `(Error as any).captureStackTrace(p);`,
  "Array.prototype.push called on it": `Array.prototype.push.call(p, 7);`,
  "Array.prototype.fill called on it": `Array.prototype.fill.call(Object.assign(p, { length: 2 }), 9);`,
  "Array.of called on the class": another(`Array.of.call(Point as any, 5, 6)`),
  "Array.from called on the class": another(`(Array.from as any).call(Point, [5, 6])`),
  "the class as the species of an array": `const a = [1, 2, 3]; (a as any).constructor = { [Symbol.species]: Point }; ${another("a.map(v => v)")}`,
  "Object.freeze": `Object.freeze(p);`,
  "Object.seal and delete": `Object.seal(p); try { delete (p as any).x; } catch (e) { console.log((e as Error).name); }`,
  "Object.preventExtensions": `Object.preventExtensions(p); try { (p as any).z = 1; } catch (e) { console.log((e as Error).name); }`,
  "delete": `delete (p as any).x;`,
  "structuredClone": `const q: Point = structuredClone(p); console.log(use(q), set(q, 3), use(q));`,
  "Object.create below it": another(`Object.create(p)`),
  "Reflect.construct for another class": another(`Reflect.construct(Point, [1, 2], class Other { sum() { return "o"; } })`),
  "Reflect.construct of Object for the class": another(`Reflect.construct(Object, [], Point)`),
  "Object.setPrototypeOf of a literal": another(`Object.setPrototypeOf({ x: "a", y: "b" }, Point.prototype)`),
  "__proto__ in a literal": another(`{ __proto__: Point.prototype, x: "a", y: 1 }`),
  "a proxy": another(`new Proxy(p, { get: (t, k) => k === "x" ? "t" : Reflect.get(t, k), set: () => false })`),
  "stores under the keys of Object.entries": `Object.entries({ x: "s" }).forEach(([k, v]) => { (p as any)[k] = v; });`,
  "stores under the keys of for-in": `for (const k in { x: 1 }) (p as any)[k] = "s";`,
  "the reviver of JSON.parse": `JSON.parse('{"x":"s"}', function (k, v) { if (k === "x") (p as any).x = v; return v; });`,
  "this of a callback of forEach": `[0].forEach(function (this: any) { this.x = "s"; }, p);`,
  "Function.prototype.call called": `Function.prototype.call.call(function (this: any) { this.x = "s"; }, p);`,
  "Reflect.apply": `Reflect.apply(function (this: any) { this.x = "s"; }, p, []);`,
  "a bound function": `(function (this: any) { this.x = "s"; }).bind(p)();`,
  "Object.assign to the prototype object": `Object.assign(Point.prototype, { sum() { return "patched"; } });`,
  "a store to the prototype object": `(Point.prototype as any).sum = function () { return "patched"; };`,
  "a setter on the prototype object": `Object.defineProperty(Point.prototype, "x", { set(v) { console.log("setter", v); }, get() { return "proto"; }, configurable: true });`,
  "Symbol.hasInstance": `Object.defineProperty(Point, Symbol.hasInstance, { value: () => false });`,
  "the comparator of sort": `[3, 1, 2].sort((a, b) => { (p as any).x = "s"; return a - b; });`,
  "toString in a template": "(p as any).toString = function () { this.x = \"s\"; return \"p\"; }; console.log(`${p}`);",
  "valueOf under unary plus": `(p as any).valueOf = function () { this.x = "s"; return 1; }; console.log(+(p as any));`,
  "toJSON": `(p as any).toJSON = function () { this.x = "s"; return 1; }; console.log(JSON.stringify(p));`,
  "Symbol.toPrimitive": "(p as any)[Symbol.toPrimitive] = function () { this.x = \"s\"; return 1; }; console.log(`${p as any}`);",
  "the key of a Map handed to forEach": `new Map([[p, 1]]).forEach((v, k) => { (k as any).x = "s"; });`,
  "the element of a Set handed to forEach": `new Set([p]).forEach(k => { (k as any).x = "s"; });`,
  "out of a WeakRef": `const w = new WeakRef(p); (w.deref() as any).x = "s";`,
  "out of a promise": `await Promise.resolve(p).then(k => { (k as any).x = "s"; });`,
  "out of Promise.withResolvers": `const r = Promise.withResolvers<any>(); r.resolve(p); (await r.promise).x = "s";`,
  "out of find": `([p] as any[]).find(k => { k.x = "s"; return true; });`,
  "out of at": `([p] as any[]).at(0).x = "s";`,
  "out of pop": `([p] as any[]).pop().x = "s";`,
  "out of flat": `([[p]] as any[]).flat()[0].x = "s";`,
  "out of Object.values": `(Object.values({ a: p }) as any[])[0].x = "s";`,
  "out of Object.fromEntries": `(Object.fromEntries([["a", p]]) as any).a.x = "s";`,
  "out of Object.groupBy": `(Object.groupBy([p], () => "a") as any).a[0].x = "s";`,
  "out of a spread": `({ ...{ a: p } } as any).a.x = "s";`,
  "out of a property descriptor": `(Object.getOwnPropertyDescriptor({ a: p }, "a") as any).value.x = "s";`,
  "out of an iterator helper": `(([p] as any[]).values() as any).map((k: any) => k).next().value.x = "s";`,
  "out of a generator": `function* g(): Generator<any> { yield p; } g().next().value.x = "s";`,
  "out of a CustomEvent": `(new CustomEvent("x", { detail: p }).detail as any).x = "s";`,
  "out of an AsyncLocalStorage": `const { AsyncLocalStorage } = await import("node:async_hooks"); const als = new AsyncLocalStorage<any>(); als.run(p, () => { als.getStore().x = "s"; });`,
  "handed to a listener of an EventEmitter": `const { EventEmitter } = await import("node:events"); const e = new EventEmitter(); e.on("a", (k: any) => { k.x = "s"; }); e.emit("a", p);`,
  "handed to a listener of an EventTarget": `const t = new EventTarget(); t.addEventListener("a", (ev: any) => { ev.detail.x = "s"; }); t.dispatchEvent(new CustomEvent("a", { detail: p }));`,
  "held by the global object, in a microtask": `(globalThis as any).held = p; await new Promise<void>(r => queueMicrotask(() => { (globalThis as any).held.x = "s"; r(); }));`,
  "held by the global object": `(globalThis as any).held = p; (globalThis as any).held.x = "s";`,
  "util.inherits": `const util = await import("node:util"); util.inherits(Point, class Base { sum() { return "base"; } } as any); delete (Point.prototype as any).sum;`,
  "Symbol.isConcatSpreadable": `(p as any)[Symbol.isConcatSpreadable] = true; (p as any).length = 1; (p as any)[0] = "e"; console.log(([] as any[]).concat(p as any));`,
  "the field made read-only": `Object.defineProperty(p, "x", { writable: false });`,
  "a read-only property on the prototype object": `Object.defineProperty(Point.prototype, "x", { value: "proto", writable: false, configurable: true });`,
  "accessors put above the prototype object": `Object.setPrototypeOf(Point.prototype, { get x() { return "up"; }, set x(v) { console.log("up setter", v); } });`,
};

export const textOf = (change: string) => head + changes[change] + tail;
