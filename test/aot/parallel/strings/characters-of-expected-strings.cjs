// STATISTIC: CharactersExpectedUnderKeys >= 2
"use strict";

// A field is expected to be a string, for its characters are read. It is read under keys, outside of loops, whatever it and they hold.
class Scanner {
  source;
  index;
  constructor(code) {
    this.source = code;
    this.index = 0;
  }
  unit() {
    return this.source.charCodeAt(this.index);
  }
  current() {
    return this.source[this.index];
  }
  next() {
    return this.source[this.index + 1];
  }
  at(key) {
    return this.source[key];
  }
  first() {
    return this.source[0];
  }
  isOpen() {
    return this.source[this.index] === "(";
  }
  advance() {
    return this.source[this.index++];
  }
  kind() {
    switch (this.source[this.index]) {
      case "(":
      case "a":
        return 1;
      case "é":
        return 2;
      case undefined:
        return 3;
      default:
        return 4;
    }
  }
}

const keys = [0, 1, 3, 60, -1, 0.5, 1.5, NaN, Infinity, 4294967295, 4294967296, 2147483647, 2147483648, -2147483648, "0", "1", "length", "x", null, undefined, true, Symbol.iterator, 2n, { toString: () => "1" }, [2]];
const sources = JSON.parse('["(ab)", "", "\\u00e9\\ud83d\\ude00(", "a", 12, null, true, ["(", "b", 4, 3], { "0": "(", "1": 5, "-1": 6, "length": 2 }]');
sources.push(undefined, "left" + "right".repeat(process.argv.length), ("x" + process.argv.length).repeat(20).slice(3, 30), new String("(boxed"), 9n, Symbol("s"), new Uint8Array([40, 41]), new Float64Array([0.5]), (function () { return arguments; })("(", 2), new Proxy(["p"], { get: (target, key) => "trap " + String(key) }), () => 1, Object.assign(Object.create({ 1: "above" }), { 0: "own" }), [1.5, 2.5], [, "hole"]);

function show(value) {
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function" || (typeof value === "object" && value !== null)) return typeof value;
  return JSON.stringify(value) + "";
}
function tell(step) {
  try {
    return show(step());
  } catch (error) {
    return error.name;
  }
}

globalThis.kept = [];
for (const source of sources) {
  const scanner = new Scanner(source);
  globalThis.kept.push(scanner);
  const row = [tell(() => scanner.unit()), tell(() => scanner.first())];
  for (const key of keys) row.push(tell(() => scanner.at(key)));
  for (const index of [0, 1, 2, 5, -1, 0.5, "1", undefined]) {
    scanner.index = index;
    row.push(tell(() => scanner.current()), tell(() => scanner.next()), tell(() => scanner.isOpen()), tell(() => scanner.kind()), tell(() => scanner.advance()), tell(() => scanner.index));
  }
  console.log(row.join(" "));
}
