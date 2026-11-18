// What is the same each time.
const held = /b/, heldGlobal = /(b)|c/g, heldSticky = /b*/y;
check(s => { heldGlobal.lastIndex = heldSticky.lastIndex = 1; return [held.test(s), held.exec(s), heldGlobal.exec(s), heldGlobal.lastIndex, heldGlobal.test(s), heldGlobal.lastIndex,
  heldSticky.exec(s), heldSticky.lastIndex, s.replace(heldGlobal, "-"), heldGlobal.lastIndex, s.search(heldGlobal), RegExp.lastMatch, RegExp.input === s]; }, oneOf(strings));
check(at => { heldGlobal.lastIndex = at; return [heldGlobal.exec("abc"), heldGlobal.lastIndex]; }, oneOf(() => [0, 3, 4, -1, 1.5, 2 ** 32, "2"]));
// A long subject is left to the ordinary search, and so is one that the pattern gives up on.
const long = "ab".repeat(400) + "c", deep = "a".repeat(200);
check(s => [/b/.test(s), /b/.exec(s)?.index, RegExp.lastMatch, s.search(/c/), /(b)(c)?/.exec(s)?.length], oneOf(() => [long, deep, long.slice(1), inside(long, "xy"), joined(deep, "bc")]));
check(s => [/(a+)+b$/.test(s), /(a+)+b$/.exec(s)?.index], oneOf(() => [deep + "c", "aab", deep.slice(100) + "b"]));
// What the last match is of must follow the latest search, and be the subject itself.
check(s => { const first = [/b/.test(s), RegExp.lastMatch, RegExp.input === s, RegExp.leftContext];
  return [first, /c/.exec(s)?.index, RegExp.lastMatch, RegExp.input === s, RegExp.rightContext, RegExp.lastParen]; }, oneOf(strings));
check(s => { const parts = [s.slice(1), s.slice(0, 3), s.substring(2)]; return parts.map(it => [/b/.test(it), RegExp.lastMatch, RegExp.input === it]); }, oneOf(strings));

function afterChange(f, change, expected) {
  for (let turn = 0; turn < 100; turn++) f();
  change();
  if (show(f()) !== show(expected)) throw new Error(`${f} gives ${show(f())}`);
}
afterChange(() => [held.test("b"), held.exec("cd")?.length], () => held.compile("(c)(d)"), [false, 3]);

const regexps = () => [/b/, /b/g, /b/y, /(a)(x)?/d, /(?<n>c)$/, Object.assign(/b/g, { lastIndex: 2 }), Object.assign(/b/g, { lastIndex: 1.5 }),
  Object.assign(/b/y, { lastIndex: { valueOf: () => 1 } }), Object.assign(/b/, { exec: () => null }), Object.freeze(/b/g), new (class extends RegExp {})("b", "g")];
for (const call of ["r.test(s)", "r.exec(s)", "s.match(r)", "s.search(r)", "s.replace(r, '-')", "s.replaceAll(r, '$&$&')", "s.split(r)", "[...s.matchAll(r)]", "new RegExp(r).flags", "r[Symbol.match](s)"])
  check(`(s, r) => { /q/.test("q"); const before = r.lastIndex, result = ${call}; return [before, result, r.lastIndex, RegExp.lastMatch]; }`, across(strings, regexps));
check(s => [/b/.test(s), /(b)/.exec(s), s.match(/b/g), s.replace(/b/g, "x"), s.replace(/(b)/, "$1$1"), s.search(/c/), s.split(/b/, 2)], oneOf(stringlike));
check((r, name) => { const first = r.test("bb"); r[name] = 0; return [first, r.test("bb"), r.lastIndex]; }, () => [[/b/g, "lastIndex"], [/b/g, "other"]]);
check((r, change) => { const before = [r.global, r.source, r.flags, r.test("b")]; change(r); return [before, r.global, r.source, r.flags, r.test("b")]; },
  () => [[/b/, () => {}], [/b/, r => r.compile("c", "g")]]);
check(n => { const r = /b/g, found = []; for (let i = 0; i < n; i++) found.push(r.test("abb"), r.lastIndex); return found; }, () => [[5]]);
check((p, f) => String(new RegExp(p, f)), () => [["a", "g"], ["a", undefined], ["(", ""], ["a", "gg"], [/b/g, undefined], [/b/g, "i"], [1, ""]]);
check(it => [it.next(), it.next(), it.next()], () => [["ab".matchAll(/./g)], ["a😀"[Symbol.iterator]()], [joined("x", "yz")[Symbol.iterator]()], [[1].values()]]);
const { next } = Object.getPrototypeOf(""[Symbol.iterator]()), nextMatch = Object.getPrototypeOf("".matchAll(/./g)).next;
check(it => [next.call(it)], () => [["a"[Symbol.iterator]()], [[1].values()], ["a".matchAll(/./g)]]);
check(it => [nextMatch.call(it)], () => [["a".matchAll(/./g)], [[1].values()], ["a"[Symbol.iterator]()]]);
check(s => [other.RegExp.prototype.exec.call(/b/, s) instanceof Array, new other.RegExp("b").exec(s) instanceof Array, other.RegExp.lastMatch], oneOf(strings));
class Derived extends RegExp { constructor(source) { super(source); } }
check(s => new Derived(s) instanceof Derived, () => [["a"]]);
afterChange(() => [heldSticky.test(""), "b".replace(/b/, "c")], () => (RegExp.prototype.exec = () => null), [false, "b"]);
