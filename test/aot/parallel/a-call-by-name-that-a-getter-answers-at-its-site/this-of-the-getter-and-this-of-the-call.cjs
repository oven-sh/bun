"use strict";
const key = JSON.parse('"who"');
const top = Object.defineProperty(JSON.parse('{"tag":"top"}'), key, { get() { const getter = this.tag; return function (x) { return getter + "/" + this.tag + "/" + x; }; }, configurable: true });
const middle = Object.create(top); middle.tag = "middle";
const bottom = Object.create(middle); bottom.tag = "bottom";
const own = Object.defineProperty({ tag: "own" }, key, Object.getOwnPropertyDescriptor(top, key));
function drive(turns) {
  const seen = new Set();
  for (let i = 0; i < turns; i++) {
    seen.add(top.who(i & 1)); seen.add(middle.who(i & 1)); seen.add(bottom.who(i & 1)); seen.add(own.who(i & 1));
    const taken = bottom.who; seen.add(String((() => { try { return taken(2); } catch (error) { return error.constructor.name; } })()));
  }
  return [...seen].join("\n");
}
console.log(drive(+(process.argv[2] ?? 200)));
