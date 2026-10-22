// Function.prototype.toString() of the functions and classes that stand behind a direct eval in their file says the text as it is written. Plain Bun shows the transpiler's reprint, which differs in one row: `class D extends K { }`.
function first(s) { return eval(s); }
function Plain(a) { this.a = a; }
const arrow = (x) => x + 1;
class K { constructor() { this.k = 1; } m() { return eval("this.k + 1"); } static s() {} }
class D extends K {}
const o = { method(a, b) { return a + b; }, get g() { return 1; }, async am() {}, *gm() {} };
function between(x) { return eval("x * 2") + eval("x * 3"); } function sameLine() { return "behind two on one line"; }
function last() { return "last"; }
for (const f of [first, Plain, arrow, K, K.prototype.m, K.s, D, o.method, Object.getOwnPropertyDescriptor(o, "g").get, o.am, o.gm, between, sameLine, last]) console.log(String(f).replace(/\s+/g, " "));
console.log(first("1 + 1"), new K().m(), between(2), /this\s*\.\s*\S+\s*=/.test(Plain + ""));
