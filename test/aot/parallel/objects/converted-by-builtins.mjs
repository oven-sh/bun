// A built-in that converts an object calls the object's own methods: what they write, delete, replace and throw is seen by the fields' readers behind the call.
class Plain {
  constructor(count) {
    this.count = count;
    this.extra = count + 1;
    this.name = "p" + count;
  }
  valueOf() {
    return this.count;
  }
  toString() {
    return this.name;
  }
  sum() {
    return this.count + this.extra;
  }
}
class Counting {
  constructor(count) {
    this.count = count;
    this.calls = 0;
  }
  valueOf() {
    this.calls++;
    return this.count;
  }
  toString() {
    this.calls = "t" + this.calls;
    return "2026-03-0" + this.count;
  }
  sum() {
    return this.calls + ":" + this.count;
  }
}
function Changing(count) {
  this.count = count;
  this.extra = "e" + count;
}
Changing.prototype.valueOf = function () {
  delete this.extra;
  this.later = this.count;
  return this.count;
};
Changing.prototype.sum = function () {
  return this.count + "/" + this.extra + "/" + this.later;
};
class Hinted {
  constructor(count) {
    this.count = count;
    this.hints = "";
  }
  [Symbol.toPrimitive](hint) {
    this.hints += hint[0];
    if (this.count === 3) throw new RangeError("hinted " + hint);
    return hint === "string" ? "2026-04-0" + this.count : this.count + 0.5;
  }
  sum() {
    return this.hints + this.count;
  }
}
const kept = [];
class Kept {
  constructor(count) {
    this.count = count;
  }
  toString() {
    kept.push(this);
    plain[0].count = this.count + 0.25;
    return "0x1" + this.count;
  }
  valueOf() {
    return {};
  }
  sum() {
    return this.count * 2;
  }
}
class Replaced {
  constructor(count) {
    this.count = count;
  }
  valueOf() {
    Replaced.prototype.valueOf = function () {
      this.count = "r" + this.count;
      return 100;
    };
    return this.count;
  }
  sum() {
    return this.count;
  }
}
class Own {
  constructor(count) {
    this.count = count;
    this.valueOf = function () {
      this.count += 0.5;
      return this.count;
    };
  }
  sum() {
    return this.count;
  }
}
class Read {
  constructor(count) {
    this.count = count;
  }
  get valueOf() {
    this.count = "g" + this.count;
    return () => 5;
  }
  get [Symbol.toStringTag]() {
    this.count = "tag" + this.count;
    return "Read";
  }
  sum() {
    return this.count;
  }
}
function make(Class) {
  const list = [];
  for (let i = 1; i < 5; i++) list.push(new Class(i));
  return list;
}
const plain = make(Plain);
const convertString = o => String(o);
const convertNumber = o => Number(o);
const convertDate = o => new Date(o).getTime();
const conversions = [
  convertString,
  convertNumber,
  convertDate,
  o => isNaN(o),
  o => parseInt(o),
  o => parseFloat(o),
  o => Math.floor(o),
  o => Math.max(o, 2),
  o => "abcdef".charAt(o),
  o => "abcdef".slice(o),
  o => "a2p1b".indexOf(o),
  o => Number.prototype.toFixed.call(1.23456, o),
  o => [1, 2, 3, 4, 5].slice(o).join(),
  o => new Array(3).fill(0).join(o),
  o => encodeURIComponent(o),
  o => String.fromCharCode(64 + Math.trunc(o)),
];
for (const Class of [Plain, Counting, Changing, Hinted, Kept, Replaced, Own, Read]) {
  const objects = Class === Plain ? plain : make(Class);
  const seen = [];
  for (const convert of conversions)
    for (const o of objects) {
      let answer;
      try {
        answer = convert(o);
      } catch (error) {
        answer = error.name;
      }
      seen.push(typeof answer + ":" + (Object.is(answer, -0) ? "-0" : `${answer}`) + "=" + o.sum());
    }
  console.log(Class.name, seen.join(" "));
  console.log(objects.map(o => Object.keys(o).join()).join(" | "), plain.map(o => o.sum()).join());
}
console.log(kept.length, kept.slice(0, 5).map(o => o.sum()).join());
let total = 0;
for (let turn = 0; turn < 200; turn++)
  for (const o of plain) total += convertNumber(o) + convertString(o).length + (convertDate(o) % 7) + o.sum();
console.log(total);
