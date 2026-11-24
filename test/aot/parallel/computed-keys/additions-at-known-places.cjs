// Additions under unknown texts, replacements and stores into fields of written objects meet in one place of the program.
"use strict";
const words = (process.env.WORDS ?? "a b a c d e f g h a 1 zz a").split(" ");
function put(target, key, value) { target[key] = value; return target; }
class Base { a = 1; b = 0.5; c = "t"; set d(value) { this.heard = value; } }
class Heir extends Base { e = null; }
const kept = [];
let total = 0;
for (let turn = 0; turn < 400; turn++) {
  const targets = [{}, { a: 1, b: 2 }, new Base(), new Heir(), Object.create(null), Object.create({ a: 3 }), kept[turn % 7] ?? {}, [], turn % 3 ? {} : Object.freeze({ a: 1 })];
  for (const target of targets) {
    for (let k = 0; k < words.length; k++) {
      const value = turn % 4 === 0 ? k : turn % 4 === 1 ? k / 2 : turn % 4 === 2 ? words[k] : { k };
      try { put(target, words[k], value); } catch (error) { total += error.constructor.name.length; }
    }
    total += Object.keys(target).length;
  }
  if (turn % 5 === 0) kept[turn % 7] = targets[turn % 6];
  if (turn % 133 === 1) console.log(targets.map(target => Object.keys(target).map(key => key + "=" + (Object(target[key]) === target[key] ? "object" : String(target[key]))).join()).join(" | "));
}
console.log(total);
