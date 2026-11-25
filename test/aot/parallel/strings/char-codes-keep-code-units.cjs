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
function isBlank(code) {
  if (code < 33) return code === 32 || code === 9;
  return code === 160 || code === 8192;
}
const turns = new Set([10, 13, 8232]);
function isTurn(code) {
  return turns.has(code);
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
class Walker {
  path;
  place;
  limit;
  constructor(path) {
    this.limit = path.length;
    this.place = 0;
    this.path = path;
  }
  back(mark) {
    this.limit = mark.limit;
    this.place = mark.place;
    return this;
  }
  isOver() {
    return !(this.place < this.limit);
  }
  pass() {
    let blanks = 0, rows = 0;
    for (let steps = 0; steps <= 50 && !this.isOver(); steps++) {
      const code = this.path.charCodeAt(this.place);
      if (code === 47) keep(code);
      else if (isTurn(code)) rows += 1;
      else if (isBlank(code)) blanks += 1;
      else break;
      ++this.place;
    }
    return rows + blanks * 100;
  }
  rest() {
    const list = [];
    for (let k = 0; k < 6; k++) {
      const code = this.path.charCodeAt(this.place);
      list.push(code, kindOf(code), code < 64, code <= 64, code > 64, code >= 64, code == 40, code != 40, code | 0, -code, code + 1, typeof code, code ? "t" : "f", code & 1, code === code);
      keep(code);
      this.place++;
    }
    return list.join();
  }
  told() {
    const code = this.path.charCodeAt(this.place);
    if (code === 40 || code === 41) return "bow";
    if (code >= 48 && code <= 57) return this.place++, "figure";
    if (code > 0xd7ff && code < 0xe000) return "half";
    if (code !== code) return "end";
    this.place++;
    return "other " + code;
  }
  beads(depth) {
    const list = [];
    for (let k = 0; k < 12; k++) {
      this.pass();
      const bead = this.told();
      list.push(bead);
      if (bead === "bow") {
        this.place++;
        if (depth) list.push("[" + this.beads(depth - 1) + "]");
      }
      if (bead === "end") break;
    }
    return list.join();
  }
}
const marks = JSON.parse('[{"place":0,"limit":6}]');
function start(path, place, limit) {
  const mark = Object.assign({}, marks[0]);
  mark.place = place;
  mark.limit = limit;
  return new Walker(path).back(mark);
}
const paths = JSON.parse('["", "a", "(a) 12/", "\\t\\u00a0 /x", "\\r\\n\\n\\r\\u2028 \\u1680\\u2000/9", "\\ud83d\\ude00(\\udc00", 12, null, {"charCodeAt": 5}, ["(", 1]]');
paths.push("left" + " /(".repeat(process.argv.length), new String(" /a"), { charCodeAt: at => at * 1.5 }, { charCodeAt: at => "40" }, { charCodeAt: () => ({}) }, { charCodeAt: at => (at > 2 ? NaN : 32) }, undefined, Symbol("s"));
const places = [0, 1, 2.5, -1, "1", null, undefined, NaN, 2147483647, 4294967296, { valueOf: () => 1 }, true, 1n, [2], Infinity, -0];
for (const path of paths) {
  for (const place of places) {
    for (const limit of [6, 3.5, "4", undefined]) {
      const line = [attempt(() => start(path, place, limit).pass()), attempt(() => start(path, place, limit).rest()), attempt(() => start(path, place, limit).told()), attempt(() => start(path, place, limit).beads(2))].join(" | ");
      out.push(line);
    }
  }
}
let sum = 0;
for (const line of out) for (let k = 0; k < line.length; k++) sum = (Math.imul(sum, 31) + line.charCodeAt(k)) | 0;
console.log(out.length, sum, codes.length, codes.filter(code => code === 47).length, codes.filter(code => code !== code).length);
for (let k = 0; k < out.length; k += 17) console.log(k, out[k].slice(0, 300));
