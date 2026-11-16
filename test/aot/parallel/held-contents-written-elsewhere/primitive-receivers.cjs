"use strict";
class Holder {
  constructor(list) {
    this.list = list;
    this.part = null;
    this.at = null;
  }
  cut(from, to) {
    this.part = this.list.slice(from, to);
    return this.part;
  }
  where(what) {
    this.at = this.list.indexOf(what);
    return this.at;
  }
  has(what) {
    return this.list.includes(what);
  }
}
const name = process.argv[5] ?? "kept";
const holder = new Holder([1, 2, 3, 4]);
globalThis[name] = holder;
console.log(String(holder.cut(1, 3)), holder.where(3), holder.has(4));
const other = globalThis[name];
other.list = "abcdef";
console.log(holder.cut(1, 3), holder.part, holder.where("d"), holder.at, holder.has("ef"));
other.list = new Uint8Array([5, 6, 7]);
console.log(String(holder.cut(1)), holder.where(7), holder.has(8));
for (const list of [7, true, Symbol("s"), 8n, null, undefined]) {
  other.list = list;
  try {
    console.log(holder.cut(0, 1));
  } catch (error) {
    console.log(error.constructor.name, String(holder.part));
  }
}
String.prototype.cutShort = 1;
Number.prototype.slice = function (from, to) {
  return [Number(this), from, to];
};
other.list = 12;
console.log(String(holder.cut(0, 1)), String(holder.part));
