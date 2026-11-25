// One closure body reads `this[target][name]` for many names: the second read finds a getter two objects above the receiver. Between two reads of one name the way up is changed in every way that a program has.
"use strict";
const said = [];
function hand(holder, target, name) {
  holder.__defineGetter__(name, function () { return this[target][name]; });
}
const names = ["size", "color", "weight", "shade", "grain", "depth", "width", "pitch"];
function world() {
  const top = {};
  for (const name of names) Object.defineProperty(top, name, { get() { return name + " of " + this.tag; }, configurable: true, enumerable: true });
  const between = Object.create(top);
  const front = {};
  for (const name of names) hand(front, "part", name);
  let made = 0;
  return {
    top, between, front,
    make() {
      const part = Object.create(between);
      part.tag = "part " + made++;
      const whole = Object.create(front);
      whole.part = part;
      return whole;
    },
  };
}
function readAll(whole) {
  let text = "";
  for (const name of names) {
    let answer;
    try { answer = whole[name]; } catch (error) { answer = error.name + ": " + error.message; }
    text += String(answer) + ";";
  }
  return text;
}
const deeds = {
  "nothing": () => {},
  "the getter is defined anew": ({ top }) => Object.defineProperty(top, "size", { get() { return "a new getter, " + this.tag; } }),
  "the getter is laid anew the old way": ({ top }) => top.__defineGetter__("color", function () { return "laid the old way, " + this.tag; }),
  "a value takes the getter's place": ({ top }) => Object.defineProperty(top, "weight", { value: "a value", writable: true }),
  "the getter is taken away": ({ top }) => { delete top.shade; },
  "the getter is taken away and another name laid": ({ top }) => { delete top.grain; top.other = "fills the room"; },
  "the getter loses its function": ({ top }) => Object.defineProperty(top, "depth", { get: undefined, set(value) {} }),
  "the object in between hides it by a value": ({ between }) => Object.defineProperty(between, "width", { value: "hidden in between", writable: true, configurable: true }),
  "the object in between hides it by a getter": ({ between }) => Object.defineProperty(between, "pitch", { get() { return "in between, " + this.tag; }, configurable: true }),
  "what hid it goes again": ({ between }) => { delete between.width; delete between.pitch; },
  "another object is laid above the one in between": ({ between }) => Object.setPrototypeOf(between, { get size() { return "from elsewhere, " + this.tag; } }),
  "the old one is laid back": ({ between, top }) => Object.setPrototypeOf(between, top),
  "nothing is laid above the top": ({ top }) => Object.setPrototypeOf(top, null),
  "the top is frozen": ({ top }) => Object.freeze(top),
};
const one = world();
const kept = one.make();
for (const [name, deed] of Object.entries(deeds)) {
  for (let round = 0; round < 40; round++) { readAll(kept); readAll(one.make()); }
  try { deed(one); } catch (error) { said.push(name + " throws " + error.name); }
  said.push(name + ": " + readAll(kept) + " | " + readAll(one.make()));
  said.push(readAll(kept) === readAll(kept));
}
const two = world();
const changed = two.make();
for (let round = 0; round < 40; round++) readAll(changed);
try { changed.part.size = 1; } catch (error) { said.push("a store where a getter alone stands above throws " + error.name); }
said.push("behind it: " + readAll(changed));
Object.defineProperty(changed.part, "size", { value: "its own", configurable: true });
said.push("the receiver's own value: " + readAll(changed) + " | " + readAll(two.make()));
delete changed.part.size;
said.push("taken away again: " + readAll(changed));
Object.setPrototypeOf(changed.part, { color: "of another parent" });
said.push("the receiver below another parent: " + readAll(changed) + " | " + readAll(two.make()));
console.log(said.join("\n"));
