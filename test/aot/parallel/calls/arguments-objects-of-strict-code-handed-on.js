// Env: BUN_JSC_verifyGC=1
"use strict";
// The `arguments` object of strict code, made for a callee that keeps it: with no, some and many arguments, fewer and more than there are parameters, integers, fractions, NaN, holes out of a spread list, objects; read, listed, changed and grown afterwards.
function Kept(list) {
  this.list = list;
}
function keepNone() { return new Kept(arguments); }
function keepOne(a) { return new Kept(arguments); }
function keepThree(a, b, c) { return new Kept(arguments); }
function keepChanged(a, b) { a = "changed"; b = undefined; return new Kept(arguments); }
const makers = [keepNone, keepOne, keepThree, keepChanged];
const lists = [
  [], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1.5], [1.5, 2.5, 3.5, 4.5, 5.5], [NaN, -0, 0, Infinity], [1, 2.5, "three", null, undefined, { six: 6 }, [7], true],
  [, 1, , 3], [1.5, , 3.5, , 5.5], new Array(5), Array.from({ length: 40 }, (_, i) => i), Array.from({ length: 40 }, (_, i) => i / 2), Array.from({ length: 300 }, (_, i) => "s" + i),
];
function describe(list) {
  const parts = [Object.prototype.toString.call(list), list.length, Object.keys(list).join(), Array.prototype.slice.call(list).map(String).join("|"), [...list].length, JSON.stringify(list).length];
  let callee;
  try { callee = typeof list.callee; } catch (error) { callee = error.constructor.name; }
  parts.push(callee, typeof list[Symbol.iterator], Object.getOwnPropertyNames(list).length, Object.is(list[1], -0), 3 in list, list[list.length]);
  return parts.join(" ");
}
const kept = [];
let text = "";
for (let round = 0; round < 400; round++) {
  for (const make of makers) {
    for (const list of lists) {
      const made = make(...list).list;
      if (round === 0) text += describe(made) + "\n";
      if ((round + list.length) % 37 === 0) kept.push([made, list.length]);
    }
  }
  if (round % 100 === 99) Bun.gc(true);
}
let wrong = 0;
for (const [made, length] of kept) {
  if (made.length !== length) wrong++;
  made[length] = "behind";
  made.extra = length;
  made.length = 0;
  if (made[length] !== "behind" || made.extra !== length || made.length !== 0) wrong++;
}
console.log(text + wrong + " " + kept.length);
