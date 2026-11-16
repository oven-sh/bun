// What charCodeAt() gives outside of loops goes to calls and comparisons: codes, NaN behind the end and in front of the start, surrogates put together.
// STATISTIC: CharacterCodesKeptBoxed >= 1
"use strict";
const Scanner = function Scanner(input) {
  this.input = String(input);
  this.pos = 0;
  this.depth = 0;
  this.out = [];
};
const sp = Scanner.prototype;
sp.full = function () {
  const next = this.input.charCodeAt(this.pos);
  if (next <= 0xd7ff || next >= 0xe000) return next;
  const second = this.input.charCodeAt(this.pos + 1);
  return second <= 0xdbff || second >= 0xe000 ? next : (next << 10) + second - 0x35fdc00;
};
const isStart = (code, wide) => (code < 65 ? code === 36 : code < 91 ? true : code < 97 ? code === 95 : code < 123 ? true : wide && code > 0xaa);
sp.read = function (code) {
  this.out.push(typeof code, code !== code ? "NaN" : code);
  return code === 40 ? this.open() : code === 41 ? -1 : code;
};
sp.open = function () {
  this.depth++;
  ++this.pos;
  const inner = this.next();
  this.depth--;
  return inner;
};
sp.next = function () {
  const code = this.full();
  if (isStart(code, this.depth > 1) || code === 92) return code + 1;
  if (code === 32) {
    ++this.pos;
    return this.next();
  }
  return this.read(code);
};
sp.all = function (limit) {
  let sum = 0;
  for (let i = 0; i < limit; i++) {
    const got = this.next();
    sum = (sum * 33 + (got === got ? got : 7)) | 0;
    ++this.pos;
  }
  return sum + this.out.join();
};
globalThis.kept = { Scanner, isStart };
for (let i = 0; i < 60; i++) new Scanner("ab (c (d) $_ 12 \u{1F600}z) \\").all(24);
console.log(new Scanner("ab (c (d) $_ 12 \u{1F600}z) \\").all(24));
console.log(new Scanner("").all(3), new Scanner("\u{10FFFF}").all(3), new Scanner("\ud800x\udc00").all(5), new Scanner("é中￿\u0000").all(6));
for (const pos of [-1, -2147483648, 2147483647, 1.5, NaN, "1", null, undefined, {}]) {
  const s = new Scanner("a(b\u{1F600}");
  s.pos = pos;
  let said;
  try { said = [s.full(), s.next(), s.pos, s.out.join()].map(String).join(" "); } catch (e) { said = e.constructor.name; }
  console.log(String(pos), said);
}
const code = (text, at) => text.charCodeAt(at);
const uses = (text, at) => {
  const c = text.charCodeAt(at);
  const list = [c, c + 1, c | 0, -c, c * 0.5, c === 97, c > 96, c != c, `${c}`, c ? "t" : "f", c ?? "none", Math.max(c, 3), JSON.stringify({ c }), [c].includes(NaN), Object.is(c, NaN), typeof c];
  return list.join(";");
};
for (const at of [0, 1, 2, -1, 3, 2 ** 31, 0.9, undefined]) console.log(uses("ab", at), code("ab", at));
