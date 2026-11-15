// Scanners that step a field before they compare it: integers, doubles, the ends of int32, strings, BigInts, objects, undefined, accessors, proxies, frozen holders.
"use strict";
const out = [];
const show = (f) => { try { const v = f(); return typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v); } catch (e) { return e.constructor.name; } };
function State(pos) { this.pos = pos; this.line = 0; }
function Scanner(input, state) { this.state = state; this.input = input; this.count = 0; }
var proto = Scanner.prototype;
proto.comment = function comment(skip) {
  var start = this.state.pos, ch = this.input.charCodeAt(this.state.pos += skip);
  if (this.state.pos < this.input.length) { while (ch !== 10 && ch !== 13 && ch !== 8232 && ++this.state.pos < this.input.length) { ch = this.input.charCodeAt(this.state.pos); } }
  return start + ":" + typeof this.state.pos + String(this.state.pos) + ch;
};
proto.down = function down() { var sum = 0; while (--this.state.pos >= 0) { sum += this.input.charCodeAt(this.state.pos); } return sum + typeof this.state.pos + String(this.state.pos); };
proto.behind = function behind() { var sum = 0; while (this.state.pos++ < this.input.length) { sum += 1; if (sum > 40) break; } return sum + typeof this.state.pos + String(this.state.pos); };
proto.lines = function lines() { var k = 0; while (k < this.input.length) { if (this.input.charCodeAt(k) === 10) ++this.state.line; ++this.count; k++; } return String(this.state.line) + typeof this.state.line + this.count; };
proto.used = function used() { var last; for (var i = 0; i < 5; i++) { last = this.state.pos++; if (last === undefined) break; } return typeof last + String(last); };
const inputs = ["abc\ndef", "", "\n", "aaaaaaaaaaaaaaaaaaaa\n\n", " x", "no end of line"];
const values = [() => 0, () => 3, () => 1.5, () => -0, () => NaN, () => Infinity, () => 2147483646, () => 2147483647, () => -2147483648, () => "2", () => "x", () => 2n, () => 9007199254740993n, () => null, () => undefined, () => true, () => ({ valueOf() { out.push("valueOf"); return 1; } }), () => [1], () => Symbol("s"), () => ({ valueOf() { return 1n; } })];
const holders = [(p) => new State(p), (p) => Object.freeze(new State(p)), (p) => ({ pos: p, line: p }), (p) => Object.defineProperty(new State(0), "pos", { get() { return p; }, set(v) { p = v; }, configurable: true }), (p) => new Proxy(new State(p), {}), (p) => { const s = new State(p); delete s.pos; return s; }, (p) => Object.create(new State(p)), (p) => { const s = new State(0); s.line = p; return s; }];
function drive() {
  for (let h = 0; h < holders.length; h++) for (let v = 0; v < values.length; v++) for (const input of inputs) {
    const line = [];
    for (const name of ["comment", "down", "behind", "lines", "used"]) { const s = new Scanner(input, holders[h](values[v]())); const pos = Number(show(() => s.state.pos).replace(/^(-?[0-9]+)n$/, "$1")); if (name !== "used" && name !== "lines" && (pos < -100 || (pos > 100 && name !== "comment"))) continue; line.push(show(() => s[name](1)), show(() => s.state.pos), show(() => s.state.line)); }
    out.push(h + "," + v + " " + line.join("|"));
  }
}
for (let round = 0; round < 2; round++) drive();
let all = 0;
for (let i = 0; i < out.length; i++) { for (let j = 0; j < out[i].length; j++) all = (Math.imul(all, 31) + out[i].charCodeAt(j)) | 0; if (i % 20 === 19) { console.log(i, all, out[i]); all = 0; } }
console.log(all);
