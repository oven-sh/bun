// The date getters of fs.Stats put their answer on the object that they are entered with, as an own property under their name.
import { Stats } from "node:fs";

const below = { a: 1, atimeMs: 5 };
Object.setPrototypeOf(below, Stats.prototype);
const before = Object.keys(below).join();
console.log(before, typeof below.atime, Object.keys(below).join(), Object.hasOwn(below, "atime"), below.a);

const handed = {
  a: 1,
  atime() {
    return "original";
  },
  b: 2,
};
Reflect.get(Stats.prototype, "atime", handed);
let answer;
try {
  answer = handed.atime();
} catch {
  answer = "throws";
}
console.log(answer, typeof handed.atime, handed.a, handed.b);

// The same for an object that native code already holds.
const held = { a: 1, atimeMs: 5, handleEvent() {} };
new EventTarget().addEventListener("x", held);
Object.setPrototypeOf(held, Stats.prototype);
console.log(typeof held.atime, Object.keys(held).join(), Object.hasOwn(held, "atime"), held.a);
