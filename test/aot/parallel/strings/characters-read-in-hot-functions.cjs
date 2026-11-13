// STATISTIC: HotCharacterReads >= 2
"use strict";

// A character that a function without loops reads, where recursion or nested loops reach it: the field is expected to be a string and may hold anything.
const log = [];
const show = value => (typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "object" : String(value));
const attempt = step => {
  try {
    log.push(show(step()));
  } catch (error) {
    log.push(error.constructor.name);
  }
};
class Scanner {
  source;
  index;
  constructor(source, index) {
    this.source = source;
    this.index = index;
  }
  lex() {
    const code = this.source.charCodeAt(this.index);
    if (code === 40 || code === 41) return "paren";
    if (code >= 48 && code <= 57) return this.number(code);
    if (code > 0xd7ff && code < 0xe000) return "half";
    if (code !== code) return "end";
    this.index++;
    return "other " + code;
  }
  number(code) {
    this.index++;
    const next = this.source.charCodeAt(this.index);
    return next >= 48 && next <= 57 ? this.number(next) : "number " + code + typeof next;
  }
  tokens(depth) {
    const list = [];
    for (let k = 0; k < 9; k++) {
      const token = this.lex();
      list.push(token);
      if (token === "paren") {
        this.index++;
        if (depth) list.push("[" + this.tokens(depth - 1) + "]");
      }
      if (token === "end" || token === "half") break;
    }
    return list.join();
  }
}
const sources = JSON.parse('["", "a", "(a) 12/3", "\\u00a0\\u2028(1", "\\ud83d\\ude00(", 12, null, {"charCodeAt": 5}, ["(", 1]]');
sources.push("(" + "1 ".repeat(process.argv.length), new String("(2a"), { charCodeAt: at => at * 20 }, { charCodeAt: () => "40" }, { charCodeAt: () => ({}) }, undefined, Symbol("s"), () => 1);
const indexes = [0, 1, 2.5, -1, "1", null, undefined, NaN, 4294967296, { valueOf: () => 1 }, true, 1n, [2], -0];
for (const source of sources) {
  for (const index of indexes) {
    attempt(() => new Scanner(source, index).lex());
    attempt(() => new Scanner(source, index).tokens(2));
  }
}
let seen = 0;
for (let turn = 0; turn < 40; turn++) {
  for (let k = 0; k < 20; k++) seen += new Scanner("(a1)22 b", k % 9).tokens(1).length;
}
console.log(seen, log.length);
console.log(log.join("\n"));
