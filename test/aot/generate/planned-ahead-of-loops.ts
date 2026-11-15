// Lists that grow in loops, texts put together in loops, counters, constant collections, awaited calls: what the compiler plans ahead must not show.
import { programsOf } from "../generate";

const head = `function key(value) { return process.argv.length > 100 ? undefined : value; }
function attempt(f) { try { return f(); } catch (error) { return error?.constructor?.name; } }
const order = [];
function note(x) { order.push(x); return x; }
`;
const cases: Record<string, string> = {
  // capacities
  "a-loop-of-a-billion-turns-left-at-once": `function f(n) { const a = []; for (let i = 0; i < n; i++) { a.push(i); if (i >= 3) break; } return a; }\nSHOW f(key(1e9)).length + "," + f(key(4e9)).length + "," + f(key(Infinity)).length + "," + f(key(2 ** 53)).length`,
  "a-loop-of-a-billion-turns-left-by-a-throw": `function f(n) { const a = []; try { for (let i = 0; i < n; i++) { a.push(i); if (i >= 3) throw 1; } } catch { } return a; }\nSHOW f(key(1e9)).length + "," + f(key(2 ** 32)).length`,
  "a-loop-of-a-billion-turns-left-by-a-return": `function f(n) { const a = []; for (let i = 0; i < n; i++) { a.push(i); if (a.length > 3) return a; } return a; }\nSHOW f(key(2 ** 31)).length + "," + f(key(2 ** 32 - 1)).length`,
  "a-bound-that-is-no-number": `function f(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return a.length; }\nSHOW [NaN, -1, -0, "3", null, undefined, 2.5, { valueOf() { return 2; } }, [4], true, -Infinity, 1e-9].map(n => f(key(n))).join()`,
  "a-bound-that-changes-in-the-loop": `function f(n) { const a = []; for (let i = 0; i < n; i++) { a.push(i); if (i === 1) n = 3; } return a.length; }\nSHOW f(key(1e9))`,
  "a-bound-read-from-the-list-itself": `function f(a) { for (let i = 0; i < a.length && i < 5; i++) a.push(i); return a.length; }\nSHOW f(key([1, 2]))`,
  "a-list-of-the-length-of-another-that-shrinks": `function f(from) { const a = []; for (let i = 0; i < from.length; i++) { a.push(from[i]); from.length = Math.min(from.length, 2); } return a; }\nSHOW f(key([1, 2, 3, 4, 5])).join()`,
  "a-step-of-zero-or-less": `function f(n, step) { const a = []; for (let i = 0; i < n; i += step) { a.push(i); if (a.length > 4) break; } return a.length; }\nSHOW [0, -1, 0.5, 1e-300, NaN, 1e300].map(step => f(key(10), key(step))).join()`,
  "counting-down": `function f(n) { const a = []; for (let i = n; i > 0; i--) { a.push(i); if (a.length > 4) break; } return a.length; }\nSHOW [3, 1e9, 2 ** 53, Infinity, -1].map(n => f(key(n))).join()`,
  "new-array-of-a-length": `function f(n) { return attempt(() => { const a = new Array(n); for (let i = 0; i < 2; i++) a[i] = i; return a.length + ":" + Object.keys(a).length; }); }\nSHOW [0, 3, -1, 2.5, 2 ** 32, 2 ** 32 - 1, "3", NaN].map(n => f(key(n))).join()`,
  "stores-by-index-in-a-loop-with-holes": `function f(n) { const a = []; for (let i = 0; i < n; i += 2) a[i] = i; return a.length + ":" + Object.keys(a) + ":" + (1 in a); }\nSHOW f(key(7))`,
  "a-list-grown-while-frozen": `function f(n) { const a = []; Object.freeze(a); return attempt(() => { for (let i = 0; i < n; i++) a.push(i); return a.length; }); }\nSHOW f(key(3))`,
  "a-list-with-a-length-that-cannot-be-written": `function f(n) { const a = []; Object.defineProperty(a, "length", { writable: false }); return attempt(() => { for (let i = 0; i < n; i++) a.push(i); return a.length; }); }\nSHOW f(key(3))`,
  "a-map-and-a-set-grown-in-a-long-loop-left-at-once": `function f(n) { const m = new Map(), s = new Set(); for (let i = 0; i < n; i++) { m.set(i, i); s.add(i); if (i >= 3) break; } return m.size + s.size; }\nSHOW f(key(1e9)) + "," + f(key(2 ** 40))`,
  "nested-loops-whose-product-is-huge": `function f(n) { const a = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { a.push(j); if (a.length > 5) return a.length; } return a.length; }\nSHOW f(key(1e6)) + "," + f(key(2 ** 31))`,
  // builders
  "text-put-together-from-objects": `function f(parts) { let s = ""; for (let i = 0; i < parts.length; i++) s += parts[i]; return s; }\nSHOW f(key([1, "a", null, undefined, { toString() { return note("t"); } }, [1, 2], 1.5, -0, 2n, true])) + order`,
  "text-put-together-with-a-symbol": `function f(parts) { let s = ""; for (let i = 0; i < parts.length; i++) s += parts[i]; return s; }\nSHOW attempt(() => f(key(["a", Symbol.iterator])))`,
  "text-read-in-the-loop-that-builds-it": `function f(n) { let s = ""; const seen = []; for (let i = 0; i < n; i++) { s += "ab"; seen.push(s.length, s[i], s.charCodeAt(s.length - 1)); } return s + seen; }\nSHOW f(key(3))`,
  "text-kept-from-every-turn": `function f(n) { let s = ""; const all = []; for (let i = 0; i < n; i++) { s += i; all.push(s); } return all.join(); }\nSHOW f(key(4))`,
  "text-put-in-front": `function f(n) { let s = ""; for (let i = 0; i < n; i++) s = i + s + i; return s; }\nSHOW f(key(4))`,
  "text-too-long": `function f(n) { let s = "x", turns = 0; try { for (let i = 0; i < n; i++) { s += s; turns++; } } catch (error) { return error.constructor.name + turns; } return turns; }\nSHOW f(key(40))`,
  "a-count-kept-outside-while-the-text-grows-too-long": `let turns = 0;\nfunction f(n) { let s = "x"; for (let i = 0; i < n; i++) { s += s; turns++; } return s.length; }\nSHOW attempt(() => f(key(40))) + turns`,
  "text-with-halves-of-pairs": `function f(parts) { let s = ""; for (const part of parts) s += part; return s.length + ":" + s.codePointAt(0) + ":" + s.isWellFormed(); }\nSHOW f(key(["\\ud83d", "\\ude00"])) + f(key(["\\ude00", "\\ud83d", "é", "a"]))`,
  "text-joined-in-a-loop-with-a-number-first": `function f(n) { let s = 0; for (let i = 0; i < n; i++) s += i < 2 ? i : "t"; return s; }\nSHOW f(key(4))`,
  "a-template-in-a-loop": `function f(list) { let s = ""; for (const each of list) s = \`\${s}[\${each}]\`; return s; }\nSHOW f(key([1, { toString() { return "o"; } }, null]))`,
  // counters
  "a-counter-past-the-integers": `function f(from, turns) { let i = from; for (let t = 0; t < turns; t++) i++; return i; }\nSHOW [2 ** 31 - 2, 2 ** 32 - 2, 2 ** 53 - 2, -(2 ** 31) - 2, 0.5, -0].map(from => f(key(from), key(4))).join()`,
  "a-counter-that-goes-down-past-the-integers": `function f(from, turns) { let i = from; for (let t = 0; t < turns; t++) i--; return i; }\nSHOW [-(2 ** 31) + 2, -(2 ** 53) + 2, 1].map(from => Object.is(f(key(from), key(4)), -0) + ":" + f(key(from), key(4))).join()`,
  "a-counter-multiplied": `function f(turns) { let i = 1; for (let t = 0; t < turns; t++) i *= 3; return i; }\nSHOW [19, 20, 21, 33, 34, 40, 700].map(turns => f(key(turns))).join()`,
  "a-counter-to-minus-zero": `function f(turns) { let i = -2; for (let t = 0; t < turns; t++) i += 1; return Object.is(i, -0) + ":" + Object.is(i * -1, -0) + ":" + 1 / (i * -1); }\nSHOW f(key(2))`,
  "a-counter-as-an-index-past-the-end": `function f(a, n) { let total = 0; for (let i = 0; i <= n; i++) total += a[i] ?? -1; return total; }\nSHOW f(key([1, 2, 3]), key(5))`,
  "a-counter-with-a-bound-past-the-integers": `function f(from, to) { let turns = 0; for (let i = from; i <= to; i++) { if (++turns > 5) break; } return turns; }\nSHOW f(key(2 ** 31 - 3), key(2 ** 31 - 1)) + "," + f(key(2 ** 31 - 3), key(2 ** 31 + 1)) + "," + f(key(2 ** 53 - 2), key(2 ** 53))`,
  "a-shifted-counter": `function f(turns) { let i = 1; for (let t = 0; t < turns; t++) i <<= 1; return i; }\nSHOW [30, 31, 32, 33].map(turns => f(key(turns))).join()`,
  // constant collections
  "a-constant-map-changed-later": `const table = new Map([["a", 1], ["b", 2]]);\nfunction read(k) { return table.get(k); }\nfunction change() { table.set("a", 9); table.delete("b"); table.set("c", 3); }\nSHOW read(key("a")) + "" + (change(), read(key("a"))) + read(key("b")) + [...table.keys()]`,
  "a-constant-set-with-odd-members": `const table = new Set([0, -0, NaN, NaN, "0", 1n, null, undefined, 1.0, 1]);\nfunction has(v) { return table.has(v); }\nSHOW table.size + [0, -0, NaN, "0", 1n, null, undefined, 1, "1", 2n].map(v => has(key(v) ?? v)).join()`,
  "a-constant-map-with-one-key-twice": `const table = new Map([["a", 1], ["b", 2], ["a", 3]]);\nfunction read() { return [...table].join("|"); }\nSHOW read()`,
  "a-constant-map-made-in-a-function-each-time": `function make() { return new Map([["a", 1]]); }\nSHOW (make() === make()) + "" + (m => (m.set("b", 2), make().size))(make())`,
  "a-constant-set-walked-while-it-changes": `const table = new Set([1, 2, 3]);\nfunction walk() { const seen = []; for (const each of table) { seen.push(each); if (each === 1) { table.delete(2); table.add(4); } } return seen.join(); }\nSHOW walk() + walk()`,
  "a-constant-map-with-a-member-added-to-the-object": `const table = new Map([["a", 1]]);\nfunction add() { table.extra = 1; return Object.keys(table) + table.extra + (table instanceof Map) + Object.prototype.toString.call(table); }\nSHOW add()`,
  "a-constant-map-with-keys-that-are-objects": `const k = {};\nconst table = new Map([[k, 1], [{}, 2]]);\nfunction read(x) { return table.get(x); }\nSHOW read(k) + String(read({})) + table.size`,
  "a-constant-list-of-pairs-changed-before-the-map": `const pairs = [["a", 1], ["b", 2]];\npairs[key(0)][1] = 9;\nconst table = new Map(pairs);\nfunction read(x) { return table.get(x); }\nSHOW read("a")`,
  // awaited calls
  "the-order-of-awaited-calls-and-jobs": `async function inner(x) { note("in" + x); return x; }\nasync function outer(x) { note("a" + x); await inner(x); note("b" + x); await inner(x); note("c" + x); }\nSHOW (outer(1), Promise.resolve().then(() => note("j1")).then(() => note("j2")).then(() => note("j3")).then(() => note("j4")), outer(2), await new Promise(done => setTimeout(done, 5)), order.join())`,
  "an-awaited-call-that-gives-a-promise": `async function inner(x) { return Promise.resolve(x); }\nasync function outer(x) { note("a"); note(await inner(x)); }\nSHOW (outer(1), Promise.resolve().then(() => note("j1")).then(() => note("j2")).then(() => note("j3")).then(() => note("j4")).then(() => note("j5")), await new Promise(done => setTimeout(done, 5)), order.join())`,
  "an-awaited-call-that-gives-a-thenable": `async function inner(x) { return { then(done) { note("then"); done(x); } }; }\nasync function outer(x) { note("a"); note(await inner(x)); }\nSHOW (outer(1), Promise.resolve().then(() => note("j1")).then(() => note("j2")).then(() => note("j3")).then(() => note("j4")), await new Promise(done => setTimeout(done, 5)), order.join())`,
  "an-awaited-call-that-throws": `async function inner(x) { if (x) throw new RangeError("no"); return x; }\nasync function outer(x) { try { await inner(x); note("fine"); } catch (error) { note(error.constructor.name); } finally { note("finally"); } }\nSHOW (outer(1), outer(0), Promise.resolve().then(() => note("j1")).then(() => note("j2")), await new Promise(done => setTimeout(done, 5)), order.join())`,
  "awaits-with-the-constructor-of-the-promise-replaced": `async function inner(x) { return x; }\nasync function outer(p) { note(await p); }\nSHOW (() => { const p = inner(1); Object.defineProperty(p, "constructor", { get() { note("asked"); return Promise; } }); outer(p); return 1; })() + (await new Promise(done => setTimeout(done, 5)), order.join())`,
  "an-awaited-call-in-a-loop": `async function inner(x) { return x * 2; }\nasync function outer(n) { let total = 0; for (let i = 0; i < n; i++) { total += await inner(i); note(i); } return total; }\nSHOW (outer(3).then(note), Promise.resolve().then(() => note("j1")).then(() => note("j2")).then(() => note("j3")).then(() => note("j4")).then(() => note("j5")), await new Promise(done => setTimeout(done, 5)), order.join())`,
  "an-awaited-method": `class C { async m(x) { note("m"); return x; } async n(x) { note("n1"); const got = await this.m(x); note("n2"); return got; } }\nSHOW (new C().n(1).then(note), Promise.resolve().then(() => note("j1")).then(() => note("j2")).then(() => note("j3")), await new Promise(done => setTimeout(done, 5)), order.join())`,
  "a-returned-await-and-a-returned-call": `async function inner(x) { return x; }\nasync function one(x) { return await inner(x); }\nasync function two(x) { return inner(x); }\nSHOW (one(1).then(note), two(2).then(note), Promise.resolve().then(() => note("j1")).then(() => note("j2")).then(() => note("j3")).then(() => note("j4")), await new Promise(done => setTimeout(done, 5)), order.join())`,
  "next-tick-and-jobs-between-awaits": `async function inner(x) { return x; }\nasync function outer() { await inner(1); note("a"); await inner(2); note("b"); }\nSHOW (process.nextTick(() => note("tick")), outer(), queueMicrotask(() => note("job")), setImmediate(() => note("immediate")), await new Promise(done => setTimeout(done, 5)), order.join())`,
};
const files = () => {
  const written: Record<string, string> = {};
  for (const name in cases) {
    const at = cases[name].lastIndexOf("SHOW ");
    written[`planned-ahead-${name}.js`] = `// ${name.replaceAll("-", " ")}\n${head}${cases[name].slice(0, at)}async function look() { return ${cases[name].slice(at + 5)}; }\nconsole.log(String(await look()));\n`;
  }
  written["planned-ahead-text-too-long.todo.txt"] = "the text is never read, the operation that joins it goes, and with it the RangeError of a text that is too long: 40 for RangeError30\n";
  return written;
};

export const programs = () => programsOf(files());
