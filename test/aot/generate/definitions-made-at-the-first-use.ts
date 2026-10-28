// A class, a function or a pattern that a top-level binding holds may be made when the binding is first read. What a program can find out must not depend on when that is.
import { programsOf } from "../generate";

const head = `function key(name) { return process.argv.length > 100 ? "none" : name; }
function attempt(f) { try { return f(); } catch (error) { return error?.constructor?.name; } }
function names(o) { return Reflect.ownKeys(o).map(String).join(); }
function shape(C) { return names(C) + "|" + names(C.prototype) + "|" + Object.entries(Object.getOwnPropertyDescriptors(C.prototype)).map(([n, d]) => n + ("value" in d ? "v" : "") + (d.get ? "g" : "") + (d.set ? "s" : "") + (d.enumerable ? "e" : "") + (d.writable ? "w" : "") + (d.configurable ? "c" : "")).join(); }
`;
// One file each: text, then SHOW an expression. `late` stands for whatever happens between the definition and the first use.
const cases: Record<string, string> = {
  "members-with-one-name-twice": `class C { a() { return 1; } b() {} a() { return 2; } }\nSHOW shape(C) + new C().a()`,
  "a-getter-then-a-method-of-one-name": `class C { get a() { return 1; } b() {} a() { return 2; } }\nSHOW shape(C) + new C().a()`,
  "a-method-then-a-getter-of-one-name": `class C { a() { return 2; } b() {} get a() { return 1; } }\nSHOW shape(C) + new C().a`,
  "a-getter-and-a-setter-apart": `class C { get a() { return 1; } b() {} set a(v) {} }\nSHOW shape(C)`,
  "a-getter-a-method-and-a-setter": `class C { get a() { return 1; } a() {} set a(v) {} }\nSHOW shape(C) + new C().a`,
  "static-and-not-of-one-name": `class C { static a() { return 1; } a() { return 2; } static b() {} }\nSHOW shape(C) + C.a() + new C().a()`,
  "a-method-named-proto": `class C { __proto__() { return 1; } static __proto__() { return 2; } }\nSHOW shape(C) + new C().__proto__() + C.__proto__() + (Object.getPrototypeOf(C) === Function.prototype)`,
  "a-static-method-named-constructor": `class C { static constructor() { return 1; } }\nSHOW shape(C) + C.constructor()`,
  "methods-named-like-those-of-functions": `class C { static call() { return 1; } static bind() { return 2; } static toString() { return "text"; } static caller() {} static arguments() {} }\nSHOW shape(C) + C`,
  "methods-named-by-symbols": `class C { [Symbol.iterator]() { return [1][Symbol.iterator](); } static [Symbol.hasInstance]() { return true; } get [Symbol.toStringTag]() { return "T"; } }\nSHOW shape(C) + [...new C()] + (1 instanceof C) + String(new C())`,
  "methods-named-by-numbers-and-strings": `class C { 1() {} "b c"() {} 0() {} a() {} 1.5() {} }\nSHOW shape(C)`,
  "every-kind-of-method": `class C { *g() { yield 1; } async a() {} async *ag() {} static *sg() {} get x() { return 1; } static set y(v) {} }\nSHOW shape(C) + Object.getPrototypeOf(C.prototype.g).constructor.name + C.prototype.a.constructor.name + names(C.prototype.g) + names(C.prototype.a)`,
  "names-and-lengths-of-members": `class C { constructor(a, b) {} m(a, b = 1) {} get x() { return 1; } static s(...r) {} }\nSHOW C.name + C.length + C.prototype.m.name + C.prototype.m.length + Object.getOwnPropertyDescriptor(C.prototype, "x").get.name + C.s.name`,
  "a-class-expression-with-a-name-of-its-own": `const C = class Inner { who() { return Inner.name + (Inner === C); } };\nSHOW C.name + new C().who()`,
  "a-class-expression-without-a-name": `const C = class { };\nconst D = C;\nSHOW C.name + D.name + names(C)`,
  "two-bindings-for-one-class": `class C { }\nconst D = C;\nSHOW (C === D) + "" + (new D() instanceof C)`,
  "private-members": `class C { #p = 1; #m() { return this.#p; } static #s() { return 2; } get #g() { return 3; } all() { return this.#m() + C.#s() + this.#g; } static has(o) { return #p in o; } }\nSHOW shape(C) + new C().all() + C.has(new C()) + C.has({})`,
  "a-class-below-a-class": `class B { b() { return 1; } static sb() { return 2; } }\nclass C extends B { c() { return super.b(); } static sc() { return super.sb(); } }\nSHOW shape(C) + new C().c() + C.sc() + (Object.getPrototypeOf(C) === B) + (Object.getPrototypeOf(C.prototype) === B.prototype)`,
  "the-class-below-is-used-first": `class B { b() { return 1; } }\nclass C extends B { }\nclass D extends C { }\nSHOW new D().b() + "" + (new D() instanceof B) + (Object.getPrototypeOf(D) === C)`,
  "the-class-above-gets-another-parent-in-between": `class A { a() { return "a"; } }\nclass B { }\nclass C extends B { }\nObject.setPrototypeOf(B.prototype, A.prototype);\nObject.setPrototypeOf(B, A);\nSHOW new C().a() + (Object.getPrototypeOf(C) === B)`,
  "the-prototype-above-gets-a-member-in-between": `class B { }\nclass C extends B { m() { return super.late(); } }\nB.prototype.late = function () { return "late"; };\nSHOW new C().m()`,
  "a-class-below-a-function-whose-prototype-changes": `function P() { }\nP.prototype.old = 1;\nclass C extends P { }\nP.prototype = { changed: 1 };\nSHOW new C().old + String(new C().changed)`,
  "a-class-below-a-function-whose-prototype-is-no-object": `function P() { }\nP.prototype = 3;\nSHOW attempt(() => { class C extends P { } return "made"; })`,
  "a-top-level-class-below-a-function-whose-prototype-is-no-object": `function P() { }\nP.prototype = key(3);\nlet reached = "no";\ntry { await import("./IMPORTED"); reached = "yes"; } catch (error) { reached = error.constructor.name; }\nSHOW reached\nFILE globalThis.P2 = function () { }; P2.prototype = 3;\nclass C extends P2 { }\nexport function use() { return C; }`,
  "a-class-below-null": `class C extends null { static s() { return 1; } }\nSHOW shape(C) + C.s() + (Object.getPrototypeOf(C.prototype) === null) + (Object.getPrototypeOf(C) === Function.prototype) + attempt(() => new C())`,
  "classes-below-built-in-classes": `class A extends Array { }\nclass M extends Map { }\nclass E extends Error { }\nclass P extends Promise { }\nclass O extends Object { }\nclass F extends Function { }\nclass R extends RegExp { }\nclass U extends Uint8Array { }\nSHOW [A, M, E, P, O, F, R, U].map(C => Object.getPrototypeOf(C).name + (attempt(() => new C(C === P ? () => { } : undefined)) instanceof C)).join()`,
  "classes-below-what-is-no-constructor": ["Math", "JSON", "Symbol.iterator", "(() => { })", "(async function () { })", "(function* () { })", "Math.max", "Function.prototype", "parseInt", "undefined", "3", "({})", "Reflect", "Proxy", "globalThis", "Atomics", "Intl", "Object.prototype.toString", "Symbol", "BigInt", "Date.now", "(function () { }).bind()", "new Proxy(class { }, {})", "Object.getPrototypeOf(Uint8Array)", "Object.getPrototypeOf(async function* () { }).constructor", "Iterator", "WeakRef", "FinalizationRegistry", "SharedArrayBuffer", "DataView", "AggregateError", "Intl.Collator", "WebAssembly.Module", "URL", "Blob", "Request", "Response", "Headers", "EventTarget", "Event", "AbortController", "TextDecoder", "Buffer", "ReadableStream", "Bun.Glob", "Bun.Transpiler", "Bun.serve", "Bun.file", "process.nextTick", "setTimeout", "queueMicrotask", "structuredClone", "fetch", "console.log", "require", "performance.now", "crypto.subtle", "crypto.randomUUID"].map((parent, i) => `MODULE m${i} const parent = ${parent};\nclass C extends parent { }\nexport function use() { return C; }`).join("\n") + "\nMODULES",
  "classes-below-names-of-what-is-no-constructor": ["Math", "JSON", "Reflect", "Proxy", "globalThis", "Atomics", "Intl", "parseInt", "Symbol", "BigInt", "undefined", "NaN", "Infinity", "escape", "isNaN", "setTimeout", "queueMicrotask", "structuredClone", "fetch", "console", "process", "Bun", "performance", "crypto", "navigator", "alert", "WebAssembly", "Iterator", "URL", "Buffer", "EventTarget", "Event", "Blob", "Request", "Response", "Headers", "TextDecoder", "TextEncoder", "ReadableStream", "WritableStream", "AbortSignal", "AbortController", "FormData", "URLSearchParams", "WebSocket", "Worker", "MessageChannel", "BroadcastChannel", "DOMException", "Crypto", "CryptoKey", "SubtleCrypto", "Performance", "File", "CustomEvent", "ErrorEvent", "CloseEvent", "MessageEvent", "HTMLRewriter", "ShadowRealm", "TextDecoderStream", "CompressionStream", "ByteLengthQueuingStrategy", "ReadableStreamDefaultReader", "ReadableByteStreamController", "PerformanceEntry", "PerformanceObserver", "EventSource"].map((parent, i) => `MODULE n${i} class C extends ${parent} { }\nexport function use() { return C; }`).join("\n") + "\nMODULES",
  "read-before-the-declaration": `const early = [attempt(() => f.name), attempt(() => C.name), attempt(() => r.source), attempt(() => typeof f), attempt(() => typeof C), attempt(() => typeof r), attempt(peek)];\nfunction peek() { return [f, C, r].length; }\nconst f = () => 1;\nclass C { }\nconst r = /x/;\nSHOW early + "|" + peek()`,
  "a-var-read-before-its-store": `const early = peek();\nfunction peek() { return typeof f + typeof g + typeof r; }\nvar f = () => 1;\nvar g = function () { };\nvar r = /x/;\nSHOW early + peek()`,
  "a-module-that-stops-half-way": `let failed; try { await import("./IMPORTED"); } catch (error) { failed = error.message; }\nSHOW failed + attempt(globalThis.peekF) + attempt(globalThis.peekC) + attempt(globalThis.peekR) + attempt(globalThis.peekG)\nFILE globalThis.peekF = () => typeof f; globalThis.peekC = () => typeof C; globalThis.peekR = () => typeof r; globalThis.peekG = () => typeof g;\nif (process.argv.length < 100) throw new Error("stop");\nconst f = () => 1;\nclass C { }\nconst r = /x/;\nvar g = () => 2;`,
  "a-circle-of-imports-with-a-class-below-one-not-yet-declared": `let failed = "none"; try { await import("./IMPORTED"); } catch (error) { failed = error.constructor.name; }\nSHOW failed\nFILE import { B } from "./second.js";\nexport class A { }\nexport function useB() { return B; }\nFILE2 second.js import { A } from "./IMPORTED";\nexport class B extends A { }`,
  "a-function-keeps-what-is-put-on-it": `const f = () => 1;\nfunction tag() { f.tag = (f.tag ?? 0) + 1; return f.tag; }\nSHOW tag() + "" + tag() + f.name + (f === f)`,
  "a-function-expression-and-its-prototype": `const F = function () { this.x = 1; };\nF.prototype.m = function () { return this.x; };\nSHOW new F().m() + F.name + (F.prototype.constructor === F)`,
  "a-pattern-keeps-its-place": `const r = /a/g;\nfunction next(text) { return r.exec(text)?.index + ":" + r.lastIndex; }\nSHOW next("aaa") + next("aaa") + next("aaa") + next("aaa") + (r === r)`,
  "a-pattern-read-by-two-functions": `const r = /a/y;\nfunction one() { return r; }\nfunction two() { r.lastIndex = 2; return r; }\nSHOW (two() === one()) + "" + one().lastIndex + r.flags + r.source`,
  "a-pattern-in-a-loop-of-the-module": `const all = [];\nfor (let i = 0; i < 2; i++) { const r = /a/g; all.push(() => r); }\nSHOW all[0]() === all[1]()`,
  "a-function-in-a-loop-of-the-module": `const all = [];\nfor (let i = 0; i < 2; i++) { const f = () => 1; class C { } all.push(() => f, () => C); }\nSHOW (all[0]() === all[2]()) + "" + (all[1]() === all[3]())`,
  "a-class-with-static-members-that-run-code": `const order = [];\nfunction note(x) { order.push(x); return x; }\nclass C { static a = note("a"); static { note("block"); } static b = note("b"); m() { } }\nnote("after");\nSHOW order + names(C)`,
  "a-class-with-computed-names-that-run-code": `const order = [];\nfunction note(x) { order.push(x); return x; }\nclass C { [note("a")]() { } static [note("b")]() { } [note("c")] = 1; }\nnote("after");\nSHOW order + shape(C)`,
  "a-class-nobody-uses-with-a-name-that-throws": `let reached = "no";\ntry { await import("./IMPORTED"); reached = "yes"; } catch (error) { reached = error.constructor.name; }\nSHOW reached\nFILE const bad = { toString() { throw new RangeError("no"); } };\nclass C { [bad]() { } }\nexport function use() { return C; }`,
  "a-class-is-frozen-and-looked-at": `class C { m() { } static s() { } }\nObject.freeze(C); Object.freeze(C.prototype);\nSHOW Object.isFrozen(C) + "" + Object.isFrozen(C.prototype) + shape(C)`,
  "exported-and-seen-through-the-namespace": `import * as all from "./IMPORTED";\nSHOW Object.keys(all) + typeof all.f + typeof all.C + typeof all.r + (all.f === all.f) + all.C.name + all.default.name\nFILE export const f = () => 1;\nexport class C { }\nexport const r = /x/;\nexport default class { }`,
  "a-commonjs-module": `const all = require("./second.cjs");\nSHOW Object.keys(all) + all.f() + new all.C().m() + all.r.test("x") + (require("./second.cjs") === all)\nFILE2 second.cjs const f = () => 1;\nclass C { m() { return 2; } }\nconst r = /x/;\nmodule.exports = { f, C, r };`,
  "collected-before-the-first-use": `class C { m() { return 1; } }\nconst f = () => 2;\nconst r = /x/;\nBun.gc(true);\nfunction use() { return new C().m() + f() + String(r); }\nBun.gc(true);\nSHOW use() + use()`,
};
const files = () => {
  const written: Record<string, string> = {};
  for (const name in cases) {
    let text = cases[name];
    if (text.endsWith("MODULES")) {
      const modules = text.split(/^MODULE /m).slice(1).map(part => part.replace(/\nMODULES$/, "")).map(part => [part.slice(0, part.indexOf(" ")), part.slice(part.indexOf(" ") + 1)]);
      for (const [module, body] of modules) written[`made-at-the-first-use-${name}/${module}.js`] = body + "\n";
      written[`made-at-the-first-use-${name}/main.js`] = `// ${name.replaceAll("-", " ")}\n` + modules.map(([module, body]) => `try { const { use } = await import("./${module}.js"); console.log(${JSON.stringify(body.split("\n")[0])}, "defined", typeof use()); } catch (error) { console.log(${JSON.stringify(body.split("\n")[0])}, error?.constructor?.name); }\n`).join("");
      continue;
    }
    const [main, ...others] = text.split(/\nFILE/);
    for (const other of others) {
      if (other.startsWith("2 ")) { const rest = other.slice(2); written[`made-at-the-first-use-${name}/${rest.slice(0, rest.indexOf(" "))}`] = rest.slice(rest.indexOf(" ") + 1).replaceAll("IMPORTED", "imported.js") + "\n"; }
      else written[`made-at-the-first-use-${name}/imported.js`] = other.slice(1).replaceAll("IMPORTED", "imported.js") + "\n";
    }
    const [body, shown] = main.replaceAll("IMPORTED", "imported.js").split("\nSHOW ");
    written[`made-at-the-first-use-${name}/main.js`] = `// ${name.replaceAll("-", " ")}\n${head}${body}\n${shown.includes("await") ? "async " : ""}function look() { return ${shown}; }\nconsole.log(await look());\n`;
  }
  return written;
};

export const programs = () => programsOf(files());
