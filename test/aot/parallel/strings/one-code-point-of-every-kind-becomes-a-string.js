// String.fromCodePoint of one code point: from a method of a class without types, as a parser hands them out one by one, and of every kind of argument.
class Reader {
  constructor(text) {
    this.text = text;
    this.at = 0;
  }
  next() {
    if (this.at >= this.text.length) return -1;
    const code = this.text.codePointAt(this.at);
    this.at += code > 0xffff ? 2 : 1;
    return code;
  }
}
function copy(text) {
  const reader = new Reader(text);
  let out = "";
  for (let code = reader.next(); code !== -1; code = reader.next()) out += String.fromCodePoint(code);
  return out;
}
function show(text) {
  return Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16)).join(" ");
}
function attempt(mark, run) {
  try {
    console.log(mark + ":", show(run()));
  } catch (error) {
    console.log(mark + ":", error.constructor.name, error.message);
  }
}
const texts = ["<!DOCTYPE html>", "naïve ÿĀ", "中文 ￿￾", "a\u{1f600}b\u{10000}\u{10ffff}", "\ud800x\udfffy", ""];
for (let round = 0; round < 300; round++) for (const text of texts) if (copy(text) !== text) throw new Error("differs: " + show(text));
for (const text of texts) console.log(show(copy(text)));

function one(value) {
  return String.fromCodePoint(value);
}
const values = [0, -0, 65, 255, 256, 0xd7ff, 0xd800, 0xdfff, 0xffff, 0x10000, 0x10ffff, 0x110000, -1, 1.5, 65.0, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 65, -(2 ** 31),
  "66", "", "x", true, false, null, undefined, [], [67], {}, { valueOf() { return 68; } }, { valueOf() { throw new TypeError("from valueOf"); } }, 69n, Symbol.iterator];
for (let round = 0; round < 3; round++) values.forEach((value, index) => attempt(round + " " + index, () => one(value)));

function number(value) {
  return String.fromCodePoint(+value);
}
for (const value of [0, -0, 97, 0x4e00, 0xffff, 0x10000, 1.5, NaN, -1, 2 ** 40]) attempt("number " + value, () => number(value));
function integer(value) {
  return String.fromCodePoint(value | 0);
}
for (const value of [0, 97, 0x4e00, 0xffff, 0x10000, 0x10ffff, 0x110000, -1]) attempt("integer " + value, () => integer(value));
attempt("none", () => String.fromCodePoint());
attempt("two", () => String.fromCodePoint(97, 0x4e00));
attempt("spread", () => String.fromCodePoint(...[97, 0x1f600, 98]));
let order = "";
attempt("order", () => String.fromCodePoint({ valueOf() { order += "a"; return 97; } }) + order);
