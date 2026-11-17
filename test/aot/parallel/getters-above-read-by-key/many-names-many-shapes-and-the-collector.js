// More names and shapes than any table of places has rows, getters that throw, getters that change the way up while they run, and collections in between.
"use strict";
const said = [];
const tops = [];
for (let shape = 0; shape < 40; shape++) {
  const top = {};
  for (let filler = 0; filler < shape % 7; filler++) top["filler" + filler] = filler;
  for (let name = 0; name < 40; name++) Object.defineProperty(top, "n" + name, { get() { return shape * 1000 + name + this.add; }, configurable: true });
  tops.push(top);
}
function read(object, key) { return object[key]; }
let sum = 0;
for (let round = 0; round < 6; round++) {
  for (let shape = 0; shape < 40; shape++) {
    const low = Object.create(Object.create(tops[shape]));
    low.add = round;
    for (let name = 0; name < 40; name++) sum += read(low, "n" + name);
  }
  if (round === 2 || round === 4) Bun.gc(true);
}
said.push(sum);
const top = {
  get throws() { throw new RangeError("the getter throws for " + this.tag); },
  get changes() { delete top.next; Object.defineProperty(top, "next", { get() { return "laid by another getter, " + this.tag; }, configurable: true }); return "changed"; },
  get next() { return "as written, " + this.tag; },
  get self() { return this; },
};
const low = Object.create(Object.create(top));
low.tag = "low";
for (const key of ["next", "next", "throws", "throws", "next", "changes", "next", "next", "self", "self"]) {
  try { const answer = read(low, key); said.push(key + ": " + (answer === low ? "the receiver itself" : answer)); } catch (error) { said.push(key + ": " + error.message); }
}
for (const receiver of [7, "text", true, Symbol.for("mark"), 5n]) {
  const key = receiver === "text" ? "length" : "description";
  said.push(typeof receiver + ": " + String(read(receiver, key)) + " " + String(read(receiver, key)));
}
console.log(said.join("\n"));
