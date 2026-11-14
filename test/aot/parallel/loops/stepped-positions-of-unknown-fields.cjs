// STATISTIC: CarriedFieldStepsGuarded >= 1
"use strict";

// A loop steps a field of an object of a known class by one and reads the character there. Nothing is known of what the field holds.
class Scanner {
  source;
  index;
  length;
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.length = source.length;
  }
  save() {
    return { index: this.index, length: this.length };
  }
  restore(state) {
    this.index = state.index;
    this.length = state.length;
    return this;
  }
  halve() {
    this.index = this.index / 2;
    return this;
  }
  atEnd() {
    return this.index >= this.length;
  }
  skipWord() {
    const start = this.index++;
    while (!this.atEnd()) {
      const unit = this.source.charCodeAt(this.index);
      if (unit === 92) {
        this.index = start;
        return "escaped";
      }
      if ((unit >= 97 && unit <= 122) || unit === 95) ++this.index;
      else break;
    }
    return String(this.source).slice(start, this.index);
  }
  skipBack() {
    let units = 0;
    while (this.index >= this.length) {
      units += this.source.charCodeAt(this.index);
      --this.index;
      if (units > 1e6) break;
    }
    return units;
  }
  countWide() {
    let wide = 0;
    while (!this.atEnd()) {
      if (this.source.charCodeAt(this.index) > 255) wide++;
      this.index++;
      if (this.index % 1 === 0.5 && this.index > 3) break;
    }
    return wide;
  }
}

const start = { index: 0, length: 0 };
const values = new Function("return [0, 1, 2.5, -1, -3, 0.5, -0, NaN, '2', null, undefined, true, 2147483646, 2147483647, 2147483648, 4294967296, -2147483648, 2n, { valueOf() { return 1; } }]")();
const ends = new Function("return [5, 40, Infinity, 3.5, NaN, '6', -2, 2147483648, undefined]")();
const texts = new Function("return ['abc_def ghi', 'ab\\\\\\\\cd', '', 'éa_\u{1f600}bcdefghijklmnop', 'a'.repeat(30) + '\\\\\\\\', ]")();
const ownName = ["char", "Code", "At"].join(process.argv[9] || "");
texts.push({ [ownName](at) { return at < 4 ? 97 : 92; }, toString() { return 'own'; } });

const makeText = () => ({ [ownName]: () => 97 });

function run(method, text, index, length) {
  const scanner = new Scanner(text).restore(start).restore({ index, length });
  globalThis.last = scanner;
  if (index === 0.5) scanner.restore({ index: 1, length }).halve();
  try {
    return `${String(scanner[method]())} ${String(scanner.index)} ${typeof scanner.index}`;
  } catch (error) {
    return error.name;
  }
}

for (const method of ["skipWord", "skipBack", "countWide"]) {
  for (const text of texts) {
    for (const index of values) {
      const row = [];
      for (const end of ends) {
        const isFar = !(Math.abs(Number(index)) <= 100);
        const isEndless = method === "skipWord" ? isFar && (typeof text !== "string" || Number.isNaN(Number(index))) : isFar || !(Math.abs(Number(end)) <= 100);
        row.push(isEndless ? "-" : run(method, text, index, end));
      }
      console.log(method, String(text).length, String(index), row.join(" | "));
    }
  }
}

// The position passes the end of int32.
for (const [index, length] of [[2147483640, 2147483655], [-2147483652, -2147483640], [9007199254740985, 9007199254740992]]) {
  const scanner = new Scanner(makeText()).restore({ index, length });
  console.log(scanner.skipWord(), scanner.index);
  const own = new Scanner("abc").restore({ index, length });
  console.log(own.skipWord(), own.index);
}

const frozen = Object.freeze(new Scanner("abcdef"));
console.log(run.call(null, "skipWord", "abc", 0, 3));
try {
  frozen.skipWord();
} catch (error) {
  console.log(error.name, frozen.index);
}
