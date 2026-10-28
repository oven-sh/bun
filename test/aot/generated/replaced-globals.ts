// Programs in which a global of the language or of the host is replaced, the way clock mocks, zone libraries, seeded random numbers and fetch
// wrappers do it, and typed code then uses the global in the ordinary way. A class is replaced by an heir of itself.
//
// --aot compiles uses of the built-ins of the language without looking them up, and in return does not let a program replace them: that
// throws a TypeError. What belongs to the host can be replaced. So a program either behaves as under plain Bun or says that it was
// refused. What must never happen is that the replacement is taken in silence and the compiled code goes on using the original.
//
// A program is one global replaced by one spelling, because a replacement stays for the rest of the process.
// The replaced Error is constructed by Reflect.construct: `bun run` turns `new Error(m)` into `Error(m)`, which a class in its place refuses.
export type Target = { name: string; holder: string; replacement: string; replacementInJavaScript: string; use: string };

export const targets: Target[] = [
  { name: "Date", holder: "globalThis", replacement: "class Fake extends Date { constructor(...a: any[]) { if (a.length) super(...(a as [number])); else super(86400000); } static override now() { return 86400000; } }", replacementInJavaScript: "class Fake extends Date { constructor(...a) { if (a.length) super(...a); else super(86400000); } static now() { return 86400000; } }", use: "[new Date().getTime(), Date.now(), new Date(5).getTime(), Date.name, new Date() instanceof REAL].join()" },
  { name: "Promise", holder: "globalThis", replacement: "class Fake<T> extends Promise<T> { static override resolve(v?: any): any { (globalThis as any).hits = ((globalThis as any).hits || 0) + 1; return super.resolve(v); } }", replacementInJavaScript: "class Fake extends Promise { static resolve(v) { globalThis.hits = (globalThis.hits || 0) + 1; return super.resolve(v); } }", use: "[Promise.name, Promise.resolve(1) instanceof REAL, (globalThis as any).hits ?? 0, new Promise<void>(r => r()).constructor.name, (async () => 1)().constructor.name].join()" },
  { name: "Map", holder: "globalThis", replacement: "class Fake<K, V> extends Map<K, V> { override get(k: K): any { return 4242; } }", replacementInJavaScript: "class Fake extends Map { get(k) { return 4242; } }", use: "[Map.name, new Map([[\"a\", 1]]).get(\"a\"), new Map().constructor.name].join()" },
  { name: "Set", holder: "globalThis", replacement: "class Fake<V> extends Set<V> { override has(v: V): boolean { return false; } }", replacementInJavaScript: "class Fake extends Set { has(v) { return false; } }", use: "[Set.name, new Set([\"a\"]).has(\"a\")].join()" },
  { name: "Array", holder: "globalThis", replacement: "class Fake<V> extends Array<V> { static override isArray(v: any): v is any[] { return false; } }", replacementInJavaScript: "class Fake extends Array { static isArray(v) { return false; } }", use: "[Array.name, Array.isArray([]), new Array(3).constructor.name, Array.from([1]).constructor.name, [].constructor.name, Array.of(1).constructor.name].join()" },
  { name: "Error", holder: "globalThis", replacement: "class Fake extends Error { constructor(m?: string) { super('fake: ' + m); } }", replacementInJavaScript: "class Fake extends Error { constructor(m) { super('fake: ' + m); } }", use: "[Error.name, Reflect.construct(Error, [\"m\"]).message, new TypeError(\"t\").message, (() => { try { (null as any).x; } catch (e: any) { return e instanceof REAL; } })()].join()" },
  { name: "RegExp", holder: "globalThis", replacement: "class Fake extends RegExp { override test(s: string): boolean { return false; } }", replacementInJavaScript: "class Fake extends RegExp { test(s) { return false; } }", use: "[RegExp.name, new RegExp(\"a\").test(\"a\"), /a/.test(\"a\"), /a/.constructor.name].join()" },
  { name: "Uint8Array", holder: "globalThis", replacement: "class Fake extends Uint8Array { override at(i: number): number { return 4242; } }", replacementInJavaScript: "class Fake extends Uint8Array { at(i) { return 4242; } }", use: "[Uint8Array.name, new Uint8Array([1]).at(0), Uint8Array.from([1]).constructor.name].join()" },
  { name: "Object", holder: "globalThis", replacement: "class Fake extends Object { static override keys(o: object): string[] { return ['fake']; } }", replacementInJavaScript: "class Fake extends Object { static keys(o) { return ['fake']; } }", use: "[Object.name, Object.keys({ a: 1 }).join(), ({}).constructor.name].join()" },
  { name: "Number", holder: "globalThis", replacement: "Object.assign(function Fake(v: any) { return 4242; }, { isInteger: () => false, parseFloat: () => 7 })", replacementInJavaScript: "Object.assign(function Fake(v) { return 4242; }, { isInteger: () => false, parseFloat: () => 7 })", use: "[Number(\"5\"), Number.isInteger(1), Number.parseFloat(\"1.5\")].join()" },
  { name: "String", holder: "globalThis", replacement: "Object.assign(function Fake(v: any) { return 'fake'; }, { fromCharCode: () => 'F' })", replacementInJavaScript: "Object.assign(function Fake(v) { return 'fake'; }, { fromCharCode: () => 'F' })", use: "[String(5), String.fromCharCode(65), `${5}`].join()" },
  { name: "Boolean", holder: "globalThis", replacement: "function Fake(v: any) { return 'fake'; }", replacementInJavaScript: "function Fake(v) { return 'fake'; }", use: "[Boolean(0), [0, 1].filter(Boolean).length].join()" },
  { name: "Symbol", holder: "globalThis", replacement: "Object.assign(function Fake(d: any) { return 'fake:' + d; }, { iterator: REAL.iterator, for: () => 'F' })", replacementInJavaScript: "Object.assign(function Fake(d) { return 'fake:' + d; }, { iterator: REAL.iterator, for: () => 'F' })", use: "[String(Symbol(\"d\")), String(Symbol.for(\"k\")), typeof Symbol.iterator].join()" },
  { name: "BigInt", holder: "globalThis", replacement: "function Fake(v: any) { return 'fake'; }", replacementInJavaScript: "function Fake(v) { return 'fake'; }", use: "[String(BigInt(5)), typeof 5n].join()" },
  { name: "parseInt", holder: "globalThis", replacement: "function fake() { return 4242; }", replacementInJavaScript: "function fake() { return 4242; }", use: "[parseInt(\"5\"), Number.parseInt(\"5\")].join()" },
  { name: "parseFloat", holder: "globalThis", replacement: "function fake() { return 4242; }", replacementInJavaScript: "function fake() { return 4242; }", use: "parseFloat(\"5.5\")" },
  { name: "isNaN", holder: "globalThis", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "[isNaN(1), Number.isNaN(1)].join()" },
  { name: "structuredClone", holder: "globalThis", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "String(structuredClone({ a: 1 }))" },
  { name: "queueMicrotask", holder: "globalThis", replacement: "function fake(f: any) { (globalThis as any).hits = 1; }", replacementInJavaScript: "function fake(f) { globalThis.hits = 1; }", use: "(queueMicrotask(() => {}), (globalThis as any).hits ?? 0)" },
  { name: "setTimeout", holder: "globalThis", replacement: "function fake(f: any) { (globalThis as any).hits = 1; return 7; }", replacementInJavaScript: "function fake(f) { globalThis.hits = 1; return 7; }", use: "[String(setTimeout(() => {}, 0)) === \"7\", (globalThis as any).hits ?? 0].join()" },
  { name: "fetch", holder: "globalThis", replacement: "function fake(u: any) { return 'fake ' + u; }", replacementInJavaScript: "function fake(u) { return 'fake ' + u; }", use: "String((fetch as any)(\"x:\"))" },
  { name: "URL", holder: "globalThis", replacement: "class Fake extends URL { get href() { return 'fake'; } }", replacementInJavaScript: "class Fake extends URL { get href() { return 'fake'; } }", use: "[URL.name, new URL(\"http://h/\").href].join()" },
  { name: "TextEncoder", holder: "globalThis", replacement: "class Fake extends TextEncoder { encode(): any { return new Uint8Array(9); } }", replacementInJavaScript: "class Fake extends TextEncoder { encode() { return new Uint8Array(9); } }", use: "new TextEncoder().encode(\"a\").length" },
  { name: "console", holder: "globalThis", replacement: "{ ...REAL, log: REAL.log, info: () => { (globalThis as any).hits = 1; } }", replacementInJavaScript: "{ ...REAL, log: REAL.log, info: () => { globalThis.hits = 1; } }", use: "(console.info(\"x\"), (globalThis as any).hits ?? 0)" },
  { name: "undefined", holder: "globalThis", replacement: "5", replacementInJavaScript: "5", use: "String(undefined)" },
  { name: "NaN", holder: "globalThis", replacement: "5", replacementInJavaScript: "5", use: "String(NaN)" },
  { name: "Infinity", holder: "globalThis", replacement: "5", replacementInJavaScript: "5", use: "String(Infinity)" },
  { name: "random", holder: "Math", replacement: "function fake() { return 0.25; }", replacementInJavaScript: "function fake() { return 0.25; }", use: "Math.random()" },
  { name: "floor", holder: "Math", replacement: "function fake() { return 4242; }", replacementInJavaScript: "function fake() { return 4242; }", use: "[Math.floor(1.5), Math.floor(2)].join()" },
  { name: "max", holder: "Math", replacement: "function fake() { return 4242; }", replacementInJavaScript: "function fake() { return 4242; }", use: "Math.max(1, 2)" },
  { name: "PI", holder: "Math", replacement: "3", replacementInJavaScript: "3", use: "Math.PI" },
  { name: "parse", holder: "JSON", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "String(JSON.parse(\"[1]\"))" },
  { name: "stringify", holder: "JSON", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "JSON.stringify({ a: 1 })" },
  { name: "now", holder: "Date", replacement: "function fake() { return 4242; }", replacementInJavaScript: "function fake() { return 4242; }", use: "Date.now()" },
  { name: "keys", holder: "Object", replacement: "function fake() { return ['fake']; }", replacementInJavaScript: "function fake() { return ['fake']; }", use: "Object.keys({ a: 1 }).join()" },
  { name: "assign", holder: "Object", replacement: "function fake(t: any) { return 'fake'; }", replacementInJavaScript: "function fake(t) { return 'fake'; }", use: "String(Object.assign({}, { a: 1 }))" },
  { name: "isArray", holder: "Array", replacement: "function fake() { return false; }", replacementInJavaScript: "function fake() { return false; }", use: "Array.isArray([])" },
  { name: "from", holder: "Array", replacement: "function fake() { return ['fake']; }", replacementInJavaScript: "function fake() { return ['fake']; }", use: "Array.from([1]).join()" },
  { name: "resolve", holder: "Promise", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "String(Promise.resolve(1))" },
  { name: "isInteger", holder: "Number", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "String(Number.isInteger(1))" },
  { name: "fromCharCode", holder: "String", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "String.fromCharCode(65)" },
  { name: "ownKeys", holder: "Reflect", replacement: "function fake() { return ['fake']; }", replacementInJavaScript: "function fake() { return ['fake']; }", use: "Reflect.ownKeys({ a: 1 }).join()" },
  { name: "log", holder: "console", replacement: "function fake() { (globalThis as any).hits = 1; }", replacementInJavaScript: "function fake() { globalThis.hits = 1; }", use: "(console.log(\"swallowed\"), (globalThis as any).hits ?? 0)" },
  { name: "now", holder: "performance", replacement: "function fake() { return 4242; }", replacementInJavaScript: "function fake() { return 4242; }", use: "performance.now()" },
  { name: "randomUUID", holder: "crypto", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "crypto.randomUUID()" },
  { name: "exit", holder: "process", replacement: "function fake() { (globalThis as any).hits = 1; }", replacementInJavaScript: "function fake() { globalThis.hits = 1; }", use: "((process as any).exit(3), (globalThis as any).hits ?? 0)" },
  { name: "cwd", holder: "process", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "process.cwd()" },
  { name: "hrtime", holder: "process", replacement: "function fake() { return 'fake'; }", replacementInJavaScript: "function fake() { return 'fake'; }", use: "String((process as any).hrtime())" },
  { name: "nextTick", holder: "process", replacement: "function fake() { (globalThis as any).hits = 1; }", replacementInJavaScript: "function fake() { globalThis.hits = 1; }", use: "((process as any).nextTick(() => {}), (globalThis as any).hits ?? 0)" },
];

export const spellings = ["dot", "bracket", "variable", "define", "assign", "reflect-set", "reflect-define", "alias", "table", "text", "js-file", "js-variable"] as const;

export function program({ name, holder, replacement, replacementInJavaScript, use }: Target, spelling: (typeof spellings)[number]): { file: string; text: string; files?: Record<string, string> } {
  const held = holder === "globalThis" ? "(globalThis as any)" : `(${holder} as any)`;
  const original = `const REAL: any = ${held}.${name};`;
  const both = `${original} const FAKE: any = ${replacement}; `;
  const [text, other] = (
    {
      "dot": [`${both}${held}.${name} = FAKE;`],
      "bracket": [`${both}${held}["${name}"] = FAKE;`],
      "variable": [`${both}const key = ["${name}"][0]; ${held}[key] = FAKE;`],
      "define": [`${both}Object.defineProperty(${holder}, "${name}", { value: FAKE, writable: true, configurable: true });`],
      "assign": [`${both}Object.assign(${holder}, { ${name}: FAKE });`],
      "reflect-set": [`${both}if (!Reflect.set(${holder}, "${name}", FAKE)) throw new TypeError("Reflect.set says no");`],
      "reflect-define": [`${both}if (!Reflect.defineProperty(${holder}, "${name}", { value: FAKE, writable: true, configurable: true })) throw new TypeError("Reflect.defineProperty says no");`],
      "alias": [`${both}const g: any = ${holder}; const h = [g][0]; h.${name} = FAKE;`],
      "table": [`${both}for (const [k, v] of Object.entries({ ${name}: FAKE })) ${held}[k] = v;`],
      // Strict text: outside of strict mode JavaScript ignores an assignment to a read-only property, so a refusal could not say anything.
      "text": [`${original} new Function("REAL", "'use strict'; ${holder}.${name} = " + ${JSON.stringify(replacementInJavaScript)})(REAL);`],
      "js-file": [`${original} install();`, `export function install() { const REAL = ${holder}.${name}; ${holder}.${name} = ${replacementInJavaScript}; }\n`],
      "js-variable": [`${original} install("${name}");`, `export function install(k) { const REAL = ${holder}[k]; ${holder}[k] = ${replacementInJavaScript}; }\n`],
    } as Record<string, [string, string?]>
  )[spelling];
  const rounds = ["exit", "fetch", "log"].includes(name) ? 0 : 300;
  return {
    file: "main.ts",
    text: `${other ? 'import { install } from "./install.js";\n' : ""}const say = console.log.bind(console);
function use(REAL: any) { return ${use}; }
let warm = 0; for (let i = 0; i < ${rounds}; i++) warm += String(use(${`(${holder} as any).${name}`})).length > 0 ? 1 : 0;
(globalThis as any).hits = 0;
try { ${text}
 say(String(use(REAL)), warm); } catch (e: any) { say('THROWS', e.constructor.name, String(e.message).slice(0, 110)); }
`,
    files: other ? { "install.js": other, "install.d.ts": "export declare function install(k?: string): void;\n" } : undefined,
  };
}
