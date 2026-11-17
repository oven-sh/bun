// test() of an object converts it without the engine's own lookups.
// COUNTER: operationAOTRegExpTestOfObject >= 300
"use strict";
const hide = v => [v][JSON.parse("0")];
const log = [];
class Origin { constructor(l) { this.l = l; } name() { return "file"; } toString() { return this.name() + ":" + this.l; } }
class Token { constructor(o, s) { this.o = o; this.s = s; } toString() { return "" + this.s + "\" at " + this.o; } }
class Numbered { [Symbol.toPrimitive](hint) { log.push(hint); return hint === "string" ? "77x" : 1; } }
class Valued { toString() { return {}; } valueOf() { log.push("value"); return "12e"; } }
class Throwing { toString() { throw new RangeError("no"); } }
class Derived extends Token { toString() { return super.toString().slice(1); } }
const patterns = [/^1/, /at file/, /e$/, /x/g, /^"/y].map(hide);
const values = [new Token(new Origin(3), "12"), new Token(new Origin(4), "0x1f"), new Derived(new Origin(5), "789"), new Numbered, new Valued, [4, 5], [[" 6"]], () => 1, new Date(0), new String("31z"), Object.create({ toString() { return "9q"; } }), { toString: () => 8 }, { toString: null, valueOf: () => "55" }, "41 ", "-0", "", "  0x", "\u0100", "7\u0100", "1" + "2" + hide("3"), 3.7, -0, 1e21, 1e-7, 12, NaN, undefined, null, true, 2n ** 70n].map(hide);
function attempt(f) { try { return f(); } catch (e) { return e.name + ": " + e.message; } }
function parse(v) { return parseInt(v); }
function parseNumber(v) { return Number.parseInt(v); }
function parseRadix(v) { return parseInt(v, 16); }
function test(p, v) { return p.test(v); }
const changed = hide(/^e/);
const changes = { toString() { changed.exec = function (s) { log.push("exec " + s); return s === "end" ? {} : null; }; return "end"; } };
log.push(test(changed, changes), test(changed, "e"), test(changed, { toString() { changed.exec = () => 1; return "e"; } }.constructor === Object ? "x" : ""));
log.push(attempt(() => test(changed, { toString() { changed.exec = () => 1; return "e"; } })));
for (let round = 0; round < 3; round++)
  for (const v of values) {
    const n = attempt(() => parse(v));
    log.push(Object.is(n, -0) ? "-0" : n, attempt(() => parseNumber(v)), attempt(() => parseRadix(v)));
    for (const p of patterns) { log.push(attempt(() => test(p, v)), p.lastIndex); p.lastIndex = 0; }
  }
log.push(attempt(() => parse(new Throwing)), attempt(() => test(patterns[0], new Throwing)), attempt(() => parse(Symbol("s"))), attempt(() => test(patterns[0], hide(Symbol("s")))), attempt(() => parse(Object.create(null))));
const moved = hide(/^e/g);
log.push(test(moved, { toString() { moved.lastIndex = 1; return "ee"; } }), moved.lastIndex);
let sum = 0;
for (let i = 0; i < 400; i++) { const t = hide(new Token(new Origin(i), String(i * 7))); sum += parse(t) + (test(patterns[1], t) ? 1 : 0) + (test(patterns[0], t) ? 10000 : 0); }
log.push(sum);
const other = hide(new Token(new Origin(1), "5"));
other.toString = () => "66"; log.push(parse(other)); other.toString = undefined; log.push(attempt(() => parse(other)));
Token.prototype.toString = function () { return "changed" + this.s; }; log.push(parse(new Token(1, "4")), test(patterns[2], new Token(1, "e")));
console.log(log.join(" "));
