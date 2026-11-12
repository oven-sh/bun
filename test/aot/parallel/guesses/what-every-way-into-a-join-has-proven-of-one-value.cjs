// One value from in front is proven on every way into a join, on each way by another question: behind the join it is what the ways' answers allow together, no more. Texts, lists, numbers, nothing at all; loops left at their heads, by break, after no turn; a throw where the first question fails.
"use strict";
const said = [];
function tell(what, make) {
  try {
    said.push(what + ": " + String(make()));
  } catch (error) {
    said.push(what + ": " + error.constructor.name + ": " + error.message);
  }
}
const texts = "alpha be gamma".split(" ");
const lists = [[1, 2, 3], [4], []];
function spread(a, b) {
  let row = [];
  for (let i = 0; i <= b.length; i++) row.push(i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
function twoArms(flag, x) {
  let n = 0;
  if (flag) n += x.length; else n += x.indexOf("a");
  for (let i = 0; i < x.length; i++) n += x.charCodeAt(i) & 1;
  return n;
}
function textOrList(x) {
  let n = 0;
  if (typeof x === "string") n += x.length * 2; else if (Array.isArray(x)) n += x.length * 3; else return -1;
  for (let i = 0; i < x.length; i++) n += x[i] === undefined ? 100 : 1;
  return n;
}
function threeWays(k, x) {
  let n = 0;
  switch (k) {
    case 0: n = x.length; break;
    case 1: n = x.lastIndexOf("a"); break;
    default: n = x.slice(1).length; break;
  }
  return n + x.length;
}
function leftByBreak(x, stop) {
  let n = 0;
  for (let i = 0; i <= x.length; i++) {
    if (i === stop) break;
    n += i;
  }
  let m = 0;
  for (let j = 0; j < x.length; j++) m += j;
  return n * 100 + m;
}
function numberOrText(x) {
  let n;
  if (typeof x === "number") n = x + 1; else n = x.length;
  return typeof x === "number" ? n + x : n + x.length;
}
const table = { spread, twoArms, textOrList, threeWays, leftByBreak, numberOrText };
const chosen = JSON.parse('["spread","twoArms","textOrList","threeWays","leftByBreak","numberOrText"]');
let sum = 0;
for (const x of texts) for (const y of texts) sum += spread(x, y);
tell("texts out of a list", () => sum);
tell("past the end of the list, second", () => spread(texts[0], texts[7]));
tell("past the end of the list, first", () => spread(texts[7], texts[0]));
tell("an empty text", () => table[chosen[0]]("", "") + " " + table[chosen[0]]("ab", "") + " " + table[chosen[0]]("", "ab"));
tell("lists in place of texts", () => table[chosen[0]]([1, 2, 3], [1, 3]));
tell("a number in place of a text", () => table[chosen[0]]("ab", 5));
tell("null", () => table[chosen[0]]("ab", null));
for (const flag of [true, false]) {
  for (const x of texts) tell("two arms " + flag + " " + x, () => twoArms(flag, x));
  tell("two arms " + flag + ", nothing", () => table[chosen[1]](flag, texts[9]));
  tell("two arms " + flag + ", a list", () => table[chosen[1]](flag, ["a", "b"]));
}
for (const x of [...texts, ...lists, 5, null, undefined, { length: 2 }]) tell("a text or a list " + JSON.stringify(x), () => table[chosen[2]](x));
for (const k of [0, 1, 2]) {
  for (const x of texts) tell("three ways " + k + " " + x, () => threeWays(k, x));
  tell("three ways " + k + ", nothing", () => table[chosen[3]](k, texts[9]));
}
for (const stop of [0, 1, 9]) {
  for (const x of texts) tell("left by break " + stop + " " + x, () => leftByBreak(x, stop));
  tell("left by break " + stop + ", nothing", () => table[chosen[4]](texts[9], stop));
}
for (const x of [1, 0.5, "ab", "", texts[9]]) tell("a number or a text " + String(x), () => table[chosen[5]](x));
console.log(said.join("\n"));
