// `[x, ...set]`, `[...set, x]`, `[...one, ...other]` and `f(x, ...set)` over sets of forty members: the stub walks the table, so compiled code takes no branch for a member,
// and the list is made with room for them, so the run time is not asked for more.
// COUNT: branches <= 45000
// COUNT: operation:operationAOTAppendMembers <= 60
const numbers = new Set();
for (let n = 0; n < 40; n++) numbers.add(n * 3);
const texts = new Set();
for (let n = 0; n < 40; n++) texts.add("t" + n);
const few = new Set([2, 7, 8]);
const count = (...all) => all.length;
function behindANumber(i) { return [i, ...numbers][i % 41]; }
function behindAText(i) { return ["x", ...texts][i % 41].length; }
function inFrontOfANumber(i) { return [...numbers, i][i % 41]; }
function theSameTwice(i) { return [...numbers, ...numbers][i % 80]; }
function union(one, other) { return [...one, ...other]; }
function textsAndNumbers(i) { return String(union(texts, numbers)[i % 80]).length; }
function aFewAndAFew(i) { return [...few, i, ...few][i % 7]; }
function argumentsBehindOne(i) { return count(i, ...numbers); }
const lines = [];
for (const turn of [behindANumber, behindAText, inFrontOfANumber, theSameTwice, textsAndNumbers, aFewAndAFew, argumentsBehindOne]) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += turn(i);
  lines.push(turn.name + " " + sum);
}
console.log(lines.join("\n"));
