// An own toString and an own hasOwnProperty hide members that stand two objects above the class, on Object.prototype.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
"use strict";
class H extends Map { text() { return this.toString(); } has2(k) { return this.hasOwnProperty(k); } tag() { return Object.prototype.toString.call(this); } }
const one = new H(); const out = [];
for (let t = 0; t < 300; t++) {
  out.length = 0; out.push(one.text(), one.has2("x"), one.tag());
  if (t === 100) Object.defineProperty(one, Symbol.toStringTag, { value: "Mine" });
  if (t === 150) one.x = 1;
  if (t === 200) one.toString = () => "own";
  if (t === 250) one.hasOwnProperty = () => "never";
  if (t % 50 === 49) console.log(t, out.join(" "));
}
