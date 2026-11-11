"use strict";
const names = (o) => Object.getOwnPropertyNames(o).join();
let depth = 0;
function make(mode) {
  return class Lone {
    constructor(n) { this.size = n; }
    double() { return this.size * 2; }
    get half() { return this.size / 2; }
    static kind = mode;
    static {
      if (mode === "builds") Lone.first = new Lone(4);
      if (mode === "again" && depth++ < 1) Lone.inner = make("again");
      if (mode === "throws") throw new RangeError("half way");
    }
  };
}
const kept = [];
for (const mode of ["plain", "plain", "builds", "throws", "again", "plain", "builds"]) {
  try { kept.push(make(mode)); } catch { kept.push(null); }
  const last = kept[kept.length - 1];
  if (last && kept.length % 2 === 0) last.prototype["extra" + kept.length] = kept.length;
}
let text = "";
for (const Class of kept) {
  if (!Class) { text += "none "; continue; }
  const made = new Class(3);
  text += names(Class.prototype) + ":" + made.double() + ":" + made.half + ":" + (Object.getPrototypeOf(made) === Class.prototype) + ":" + (Class.first ? Class.first instanceof Class : "-") + ":" + (Class.inner ? names(Class.inner.prototype) + (new Class.inner(1) instanceof Class) : "-") + " ";
}
console.log(text);
