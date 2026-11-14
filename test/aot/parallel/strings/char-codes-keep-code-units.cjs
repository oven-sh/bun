// STATISTIC: CharCodesJoinedWithCodeUnits >= 2
"use strict";

// A char code read at a position that may be no int32 keeps its code unit past the test of the position: it is compared, switched on and boxed without a double.
const out = [];
const show = value => (typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "object" : String(value));
const attempt = step => {
  try {
    return show(step());
  } catch (error) {
    return error.constructor.name;
  }
};
const codes = [];
const keep = code => {
  codes.push(code);
  return code;
};
function isSpace(code) {
  return code === 32 || code === 9 || code === 160 || (code >= 5760 && [5760, 8192, 8232].indexOf(code) >= 0);
}
function isLineEnd(code) {
  return code === 10 || code === 13 || code === 8232;
}
function kindOf(code) {
  switch (code) {
    case 40:
      return "open";
    case 41:
      return "close";
    case 65:
    case 97:
      return "a";
    default:
      return code !== code ? "none" : code > 127 ? "wide" : "other";
  }
}
class Scanner {
  source;
  index;
  limit;
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.limit = source.length;
  }
  restore(state) {
    this.index = state.index;
    this.limit = state.limit;
    return this;
  }
  eof() {
    return this.index >= this.limit;
  }
  skip() {
    let spaces = 0;
    let lines = 0;
    let steps = 0;
    while (!this.eof()) {
      if (steps++ > 50) break;
      const code = this.source.charCodeAt(this.index);
      if (isSpace(code)) {
        ++this.index;
        ++spaces;
      } else if (isLineEnd(code)) {
        ++this.index;
        if (code === 13 && this.source.charCodeAt(this.index) === 10) ++this.index;
        ++lines;
      } else if (code === 47) {
        keep(code);
        ++this.index;
      } else break;
    }
    return spaces * 100 + lines;
  }
  rest() {
    const list = [];
    for (let k = 0; k < 6; k++) {
      const code = this.source.charCodeAt(this.index);
      list.push(code, kindOf(code), code < 64, code <= 64, code > 64, code >= 64, code == 40, code != 40, code | 0, -code, code + 1, typeof code, code ? "t" : "f", code & 1, code === code);
      keep(code);
      this.index++;
    }
    return list.join();
  }
  lex() {
    const code = this.source.charCodeAt(this.index);
    if (code === 40 || code === 41) return "paren";
    if (code >= 48 && code <= 57) return this.index++, "digit";
    if (code > 0xd7ff && code < 0xe000) return "half";
    if (code !== code) return "end";
    this.index++;
    return "other " + code;
  }
  tokens(depth) {
    const list = [];
    for (let k = 0; k < 12; k++) {
      this.skip();
      const token = this.lex();
      list.push(token);
      if (token === "paren") {
        this.index++;
        if (depth) list.push("[" + this.tokens(depth - 1) + "]");
      }
      if (token === "end") break;
    }
    return list.join();
  }
}
const states = JSON.parse('[{"index":0,"limit":6}]');
function start(source, index, limit) {
  const state = Object.assign({}, states[0]);
  state.index = index;
  state.limit = limit;
  return new Scanner(source).restore(state);
}
const sources = JSON.parse('["", "a", "(a) 12/", "\\t\\u00a0 /x", "\\r\\n\\n\\r\\u2028 \\u1680\\u2000/9", "\\ud83d\\ude00(\\udc00", 12, null, {"charCodeAt": 5}, ["(", 1]]');
sources.push("left" + " /(".repeat(process.argv.length), new String(" /a"), { charCodeAt: at => at * 1.5 }, { charCodeAt: at => "40" }, { charCodeAt: () => ({}) }, { charCodeAt: at => (at > 2 ? NaN : 32) }, undefined, Symbol("s"));
const indexes = [0, 1, 2.5, -1, "1", null, undefined, NaN, 2147483647, 4294967296, { valueOf: () => 1 }, true, 1n, [2], Infinity, -0];
for (const source of sources) {
  for (const index of indexes) {
    for (const limit of [6, 3.5, "4", undefined]) {
      const line = [attempt(() => start(source, index, limit).skip()), attempt(() => start(source, index, limit).rest()), attempt(() => start(source, index, limit).lex()), attempt(() => start(source, index, limit).tokens(2))].join(" | ");
      out.push(line);
    }
  }
}
let sum = 0;
for (const line of out) for (let k = 0; k < line.length; k++) sum = (Math.imul(sum, 31) + line.charCodeAt(k)) | 0;
console.log(out.length, sum, codes.length, codes.filter(code => code === 47).length, codes.filter(code => code !== code).length);
for (let k = 0; k < out.length; k += 17) console.log(k, out[k].slice(0, 300));
