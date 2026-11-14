// A function says what it takes. Besides the calls that keep to that, something gives it another value by a road that is no call in the text: the function does with it what plain Bun does.
import { programsOf } from "../generate";

const head = `type Point = { x: number; y: number };
const out: unknown[] = [];
function key<T>(name: T): T { return process.argv.length > 100 ? (undefined as any) : name; }
function attempt(f: () => unknown): unknown { try { return f(); } catch (error: any) { return error?.constructor?.name; } }
const honest: Point = { x: 1, y: 2 };
const strangers: any[] = [5, "text", null, undefined, { y: "only y" }, [7, 8], { x: { valueOf() { return 3; } }, y: 1n }, () => 1, Symbol.iterator, 2n, true, { get x() { return "got"; }, y: 0 }, new Proxy({}, { get: (_, name) => String(name) })];
function sum(p: Point): unknown { return p.x + p.y; }
`;
// BODY declares what is attacked, with an honest call. `s` is the stranger. SHOW is evaluated for every stranger.
const roads: Record<string, string> = {
  "a-setter-by-a-store-through-any": `class H { got: unknown; set v(p: Point) { this.got = p.x + p.y; } }\nconst h = new H(); h.v = honest;\nSHOW ((h as any).v = s, h.got)`,
  "a-setter-by-key": `class H { got: unknown; set v(p: Point) { this.got = p.x + p.y; } }\nconst h = new H(); h.v = honest;\nSHOW ((h as any)[key("v")] = s, h.got)`,
  "a-setter-by-assign": `class H { got: unknown; set v(p: Point) { this.got = p.x + p.y; } }\nconst h = new H(); h.v = honest;\nSHOW (Object.assign(h, { v: s }), h.got)`,
  "a-setter-by-reflect": `class H { got: unknown; set v(p: Point) { this.got = p.x + p.y; } }\nconst h = new H(); h.v = honest;\nSHOW (Reflect.set(h, "v", s), h.got)`,
  "a-setter-of-a-literal": `let got: unknown; const h = { set v(p: Point) { got = p.x + p.y; } }; h.v = honest;\nSHOW ((h as any).v = s, got)`,
  "a-setter-through-an-heir": `class H { got: unknown; set v(p: Point) { this.got = p.x + p.y; } }\nconst h = new H(); h.v = honest; const heir = Object.create(h);\nSHOW (heir.v = s, heir.got)`,
  "a-thenable": `let got: unknown; const t = { then(p: Point) { got = p.x + p.y; } }; t.then(honest);\nSHOW (Promise.resolve(t), await null, await null, typeof got)`,
  "to-primitive": `const o = { [Symbol.toPrimitive](p: Point) { return String(p.x + p.y); } }; o[Symbol.toPrimitive](honest);\nSHOW \`\${o}\` + (+o) + (o as any + s?.constructor?.name)`,
  "to-json": `const o = { toJSON(p: Point) { return String(p.x + p.y); } }; o.toJSON(honest);\nSHOW JSON.stringify(o) + JSON.stringify({ a: o }) + JSON.stringify([o, s === undefined])`,
  "has-instance": `class C { static [Symbol.hasInstance](p: Point) { out.push(p.x + p.y); return true; } }\nC[Symbol.hasInstance](honest);\nSHOW ((s as any) instanceof C) + String(out.pop())`,
  "next-of-an-iterator": `const it = { n: 0, got: undefined as unknown, [Symbol.iterator]() { return this; }, next(p: Point) { this.got = attempt(() => p.x + p.y); return { done: this.n++ > 0, value: 1 }; } }; it.next(honest);\nSHOW (it.n = 0, [...(it as any)], it.got)`,
  "return-of-an-iterator": `const it = { got: undefined as unknown, [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; }, return(p: Point) { this.got = attempt(() => p.x + p.y); return { done: true, value: 1 }; } }; it.return(honest);\nSHOW (() => { for (const each of it) break; return it.got; })()`,
  "next-of-a-generator": `function* g(): Generator<number, void, Point> { while (true) { const p = yield 1; out.push(attempt(() => p.x + p.y)); } }\nconst running = g(); running.next(honest); running.next(honest);\nSHOW ((running as any).next(s), out.pop())`,
  "map": `const f = (p: Point) => p.x + p.y; f(honest);\nSHOW [s].map(f)[0]`,
  "for-each-find-some-filter": `const f = (p: Point) => { out.push(p.x + p.y); return true; }; f(honest);\nSHOW ([s].forEach(f), [s].find(f), [s].some(f), [s].filter(f), out.splice(0).join())`,
  "reduce": `const f = (a: Point, p: Point) => ({ x: a.x + p.x, y: a.y + p.y }); f(honest, honest);\nSHOW JSON.stringify([s, s].reduce(f)) + JSON.stringify([s].reduce(f, honest))`,
  "sort": `const f = (a: Point, b: Point) => { out.push(a.x + b.y); return 0; }; f(honest, honest);\nSHOW ([s, s].sort(f), out.splice(0).join())`,
  "array-from": `const f = (p: Point) => p.x + p.y; f(honest);\nSHOW Array.from([s], f)[0]`,
  "for-each-of-a-map-and-a-set": `const f = (p: Point) => { out.push(p.x + p.y); }; f(honest);\nSHOW (new Map([[1, s]]).forEach(f), new Set([s]).forEach(f), out.splice(0).join())`,
  "replace": `const f = (p: Point) => String(p.x + p.y); f(honest);\nSHOW "abc".replace("b", f as any) + "abc".replace(/c/, f as any) + "abc".replaceAll("a", f as any)`,
  "a-reviver-and-a-replacer": `const f = (k: Point, p: Point) => (out.push(attempt(() => k.x + p.y)), p); f(honest, honest);\nSHOW (JSON.parse("[1]", f as any), JSON.stringify([s === null], f as any), out.splice(0).join())`,
  "then-of-a-promise": `const f = (p: Point) => p.x + p.y; f(honest);\nSHOW await Promise.resolve(s).then(f).catch(error => error.constructor.name)`,
  "catch-and-finally": `const f = (p: Point) => p.x + p.y; f(honest);\nSHOW await Promise.reject(s).catch(f).catch(error => error.constructor.name)`,
  "an-awaited-value": `async function f(given: Promise<Point>) { const p = await given; return p.x + p.y; }\nawait f(Promise.resolve(honest));\nSHOW await f(Promise.resolve(s)).catch(error => error.constructor.name)`,
  "timers": `const f = (p: Point) => { out.push(attempt(() => p.x + p.y)); }; f(honest); out.pop();\nSHOW (setTimeout(f, 0, s), setImmediate(f, s), process.nextTick(f, s), queueMicrotask(f as any), await new Promise(done => setTimeout(done, 5)), out.splice(0).join())`,
  "an-event": `const f = (p: Point) => { out.push(p.x + p.y); }; f(honest); out.pop(); const target = new EventTarget(); target.addEventListener("e", f as any);\nSHOW (target.dispatchEvent(new Event("e")), out.splice(0).join())`,
  "an-emitter": `import { EventEmitter } from "events";\nconst f = (p: Point) => { out.push(attempt(() => p.x + p.y)); }; f(honest); out.pop(); const emitter = new EventEmitter(); emitter.on("e", f);\nSHOW (emitter.emit("e", s), out.splice(0).join())`,
  "reflect-apply": `SHOW Reflect.apply(sum, undefined, [s])`,
  "call-and-apply": `SHOW String(attempt(() => sum.call(undefined, s))) + String(attempt(() => sum.apply(undefined, [s]))) + String(attempt(() => (sum.apply as any)(undefined, { length: 1, 0: s })))`,
  "bind": `SHOW String(attempt(() => sum.bind(undefined, s)())) + String(attempt(() => sum.bind(undefined)(s)))`,
  "call-taken-off": `const call = Function.prototype.call;\nSHOW call.call(sum, undefined, s)`,
  "a-tagged-template": `const f = (p: Point, q: Point) => String(p.x + p.y) + attempt(() => q.x + q.y); f(honest, honest);\nSHOW (f as any)\`a\${s}b\``,
  "traps-of-a-proxy": `const handler = { get(t: Point, k: Point) { return String(t.x + t.y) + attempt(() => String(k.x + k.y)); } }; handler.get(honest, honest);\nSHOW new Proxy(Object(s ?? 0), handler as any).anything`,
  "this-by-call": `class C { x = 1; y = 2; m() { return this.x + this.y; } }\nnew C().m();\nSHOW C.prototype.m.call(s)`,
  "this-taken-off": `class C { x = 1; y = 2; m() { return this.x + this.y; } }\nnew C().m(); const m = new C().m;\nSHOW [s].map(each => attempt(() => (m as any)())) + String(attempt(() => (0, new C().m)()))`,
  "this-of-a-getter-through-an-heir": `class C { x = 1; y = 2; get m() { return this.x + this.y; } }\nnew C().m;\nSHOW Object.create(C.prototype, { x: { value: s } }).m`,
  "this-of-a-method-put-on-another-object": `class C { x = 1; y = 2; m() { return this.x + this.y; } }\nnew C().m();\nSHOW ({ x: s, m: C.prototype.m } as any).m()`,
  "this-declared": `function f(this: Point) { return this.x + this.y; }\nf.call(honest);\nSHOW f.call(s)`,
  "a-constructor-by-the-class-below": `class C { got: unknown; constructor(p: Point) { this.got = p.x + p.y; } }\nclass D extends C { }\nnew D(honest);\nSHOW new (D as any)(s).got`,
  "a-constructor-by-reflect": `class C { got: unknown; constructor(p: Point) { this.got = p.x + p.y; } }\nnew C(honest);\nSHOW Reflect.construct(C, [s]).got`,
  "a-constructor-by-species": `class A extends Array<number> { static seen: unknown[] = []; constructor(p: Point) { super(); A.seen.push(attempt(() => p.x + p.y)); } }\nconst a = new A(honest);\nSHOW (a.map(each => each), a.filter(() => true), a.slice(), A.seen.splice(0).join())`,
  "a-constructor-by-array-from-and-of": `class C { static seen: unknown[] = []; length = 0; constructor(p: Point) { C.seen.push(attempt(() => p.x + p.y)); } }\nnew C(honest);\nSHOW ((Array.from as any).call(C, [s]), (Array.of as any).call(C, s), (Array.from as any).call(C, { length: 1 }), C.seen.splice(0).join())`,
  "a-constructor-by-promise-functions": `class P { static seen: unknown[] = []; constructor(p: Point) { P.seen.push(attempt(() => p.x + p.y)); (p as any)(() => { }, () => { }); } }\nattempt(() => new P(honest));\nSHOW (attempt(() => Promise.resolve.call(P, s)), P.seen.splice(0).join())`,
  "a-table-by-key": `const table = { f: (p: Point) => p.x + p.y, g: (p: Point) => p.x }; table.f(honest); table.g(honest);\nSHOW (table as any)[key("f")](s)`,
  "through-a-global": `(globalThis as any).held = sum;\nSHOW (globalThis as any).held(s)`,
  "through-text": `SHOW new Function("f", "s", "return f(s)")(sum, s)`,
  "no-argument": `SHOW [s].map(() => attempt(() => (sum as any)()))[0]`,
  "a-spread-list": `SHOW sum(...([s] as [Point]))`,
  "a-cast": `SHOW sum(s as Point)`,
  "a-cast-through-a-variable": `let kept: Point = honest;\nfunction keep(value: any) { kept = value; }\nfunction read() { return kept.x + kept.y; }\nread();\nSHOW (keep(s), read())`,
  "a-variable-a-closure-fills": `function make() { let kept: Point = honest; return { keep(value: any) { kept = value; }, read() { return kept.x + kept.y; } }; }\nconst made = make(); made.read();\nSHOW (made.keep(s), made.read())`,
  "a-guard-that-lies": `function isPoint(value: unknown): value is Point { return true; }\nSHOW isPoint(s) ? sum(s) : "no"`,
  "an-assertion-that-lies": `function assertPoint(value: unknown): asserts value is Point { }\nSHOW (() => { const v: unknown = s; assertPoint(v); return sum(v); })()`,
  "an-element-beyond-the-end": `const list: Point[] = [honest];\nSHOW sum(list[key(1)]) + String(s === 0)`,
  "a-list-seen-as-wider": `const list: Point[] = [honest]; const wider: (Point | unknown)[] = list;\nSHOW (wider[0] = s, sum(list[0]))`,
  "a-result-that-lies": `function give(value: any): Point { return value; }\ngive(honest);\nSHOW sum(give(s))`,
  "a-result-through-two-functions": `function inner(value: any): Point { return value; }\nfunction outer(value: any): Point { return inner(value); }\nouter(honest);\nSHOW sum(outer(s))`,
  "an-overload-that-lies": `function give(value: number): Point;\nfunction give(value: any): any { return strangers[value]; }\nSHOW sum(give(strangers.indexOf(s)))`,
  "a-generic-that-lies": `function give<T>(value: unknown): T { return value as T; }\nSHOW sum(give<Point>(s))`,
  "a-field-never-set": `class C { p!: Point; read() { return this.p.x + this.p.y; } }\nconst c = new C(); c.p = honest; c.read();\nSHOW [s].map(() => attempt(() => new C().read()))[0]`,
  "a-variable-never-set": `let late!: Point;\nfunction read() { return late.x + late.y; }\nSHOW [s].map(() => attempt(read))[0]`,
  "narrowing-undone-by-a-call": `let both: Point | unknown = honest;\nfunction change(value: unknown) { both = value; }\nfunction isP(value: unknown): value is Point { return value === honest; }\nSHOW (() => { both = honest; if (isP(both)) { change(s); return sum(both); } return "no"; })()`,
  "parsed-text": `const text = JSON.stringify({ p: 5, q: "text", r: null, t: { y: 1 } });\nSHOW Object.values(JSON.parse(text) as Record<string, Point>).map(each => attempt(() => sum(each))).join()`,
  "from-a-module-without-types": `import { give } from "./untyped.js";\nSHOW give(sum, s)\nFILE untyped.js export function give(f, s) { return f(s); }`,
  "a-method-of-the-class-above-by-super": `class B { m(p: Point) { return p.x + p.y; } }\nclass D extends B { n(value: any) { return super.m(value); } }\nnew B().m(honest);\nSHOW new D().n(s)`,
  "methods-named-by-symbols-that-strings-call": `const o = { [Symbol.replace](p: Point, q: Point) { return String(p.x + p.y) + attempt(() => q.x + q.y); }, [Symbol.split](p: Point) { return [String(p.x + p.y)]; }, [Symbol.search](p: Point) { return p.x + p.y; }, [Symbol.match](p: Point) { return [String(p.x + p.y)]; } };\no[Symbol.replace](honest, honest); o[Symbol.split](honest); o[Symbol.search](honest); o[Symbol.match](honest);\nSHOW "t".replace(o as any, s) + "t".split(o as any) + "t".search(o as any) + "t".match(o as any)`,
  "a-default-parameter": `function f(p: Point = honest) { return p.x + p.y; }\nf(); f(honest);\nSHOW f(s as any)`,
  "a-pattern-parameter": `function f({ x, y }: Point) { return x + y; }\nf(honest);\nSHOW f(s as any)`,
  "an-async-function": `async function f(p: Point) { return p.x + p.y; }\nawait f(honest);\nSHOW await f(s as any).catch(error => error.constructor.name)`,
  "a-number-that-is-none": `function f(n: number, list: number[]) { return list[n] + n * 2; }\nf(0, [1, 2]);\nSHOW f(s as any, [1, 2, 3])`,
  "a-list-that-is-none": `function f(list: number[]) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i]; return total; }\nf([1, 2]);\nSHOW f(s as any)`,
  "a-string-that-is-none": `function f(text: string) { return text.length + text.charCodeAt(0) + text; }\nf("ab");\nSHOW f(s as any)`,
};
const files = () => {
  const written: Record<string, string> = {};
  for (const name in roads) {
    const [main, ...others] = roads[name].split("\nFILE ");
    for (const other of others) written[`a-stranger-comes-by-${name}/${other.slice(0, other.indexOf(" "))}`] = other.slice(other.indexOf(" ") + 1) + "\n";
    const at = main.lastIndexOf("SHOW ");
    const body = main.slice(0, at), shown = main.slice(at + 5);
    const imports = body.split("\n").filter(line => line.startsWith("import ")).join("\n");
    written[`a-stranger-comes-by-${name}/main.ts`] = `// ${name.replaceAll("-", " ")}\n${imports}\n${head}sum(honest);\n${body.split("\n").filter(line => !line.startsWith("import ")).join("\n")}\nasync function look(s: any): Promise<unknown> { return ${shown}; }\nfor (const s of strangers) { try { console.log(String(await look(s))); } catch (error: any) { console.log("throws", error?.constructor?.name); } }\n`;
  }
  return written;
};

export const programs = () => programsOf(files());
