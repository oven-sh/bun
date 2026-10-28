// Now and then the constructor above returns an object that the class below has already finished.
const lines = [];
let again = null;
class Base { id = 1; constructor() { if (again) return again; } }
class Middle extends Base { #count = 0; started = 5; tick() { return ++this.#count + this.started; } }
class Leaf extends Middle { #leaf = 7; leaf() { return this.#leaf; } }
let sum = 0, thrown = 0;
const kept = [];
for (let i = 0; i < 600; i++) {
  if (i % 100 === 99) again = kept[kept.length - 1];
  try { const made = new Leaf(); sum += made.tick() + made.leaf(); if (i % 50 === 0) kept.push(made); } catch (error) { thrown += error instanceof TypeError ? 1 : 100; }
  again = null;
}
lines.push(sum, thrown, kept.length, kept[3].tick());
again = new Middle();
try { new Leaf(); lines.push("leaf over middle"); } catch (error) { lines.push(error.constructor.name); }
again = null; const target = new Base(); again = target; const upgraded = new Leaf() === target ? target : null; again = null;
lines.push(upgraded !== null, Middle.prototype.tick.call(upgraded), Leaf.prototype.leaf.call(upgraded), upgraded instanceof Leaf, Object.keys(upgraded).join(""));
console.log(lines.join(" "));
