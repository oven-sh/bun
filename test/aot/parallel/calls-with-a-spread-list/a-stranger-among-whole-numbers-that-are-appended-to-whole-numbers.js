// Whole numbers are appended to a list of whole numbers out of a list of values, and one of them is no whole number: at the end, in the middle, at the start: nothing is lost, nothing stands twice, and the receiver's storage is what a push one by one gives it. Each case has a function of its own.
const { describe } = require("bun:jsc");
const storageOf = list => /ArrayWith[A-Za-z0-9]+/.exec(describe(list))?.[0];
function textAtTheEnd(items) { const out = [0]; out.push(7, ...items); return out; }
function fractionAtTheEnd(items) { const out = [0]; out.push(7, ...items); return out; }
function undefinedAtTheEnd(items) { const out = [0]; out.push(7, ...items); return out; }
function nullInTheMiddle(items) { const out = [0]; out.push(7, ...items); return out; }
function objectAtTheStart(items) { const out = [0]; out.push(7, ...items); return out; }
function holeInTheMiddle(items) { const out = [0]; out.push(7, ...items); return out; }
function textAtTheEndOfManyOntoMany(items) { const out = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; out.push(7, ...items); return out; }
function minusZeroAtTheEnd(items) { const out = [0]; out.push(7, ...items); return out; }
function largeNumberAtTheEnd(items) { const out = [0]; out.push(7, ...items); return out; }
function strangerInTheThirdTurn(lists) { const out = []; for (const items of lists) out.push(1, ...items); return out; }
const line = (a, b, x) => a * x + b;
const partial = (fn, ...bound) => (...rest) => fn(...bound, ...rest);
const many = Array.from({ length: 30 }, (_, i) => i);
for (const [run, items] of [
  [textAtTheEnd, [1, 2, 3, "t"]], [fractionAtTheEnd, [1, 2, 3, 4.5]], [undefinedAtTheEnd, [1, 2, 3, undefined]], [nullInTheMiddle, [1, null, 3]], [objectAtTheStart, [{ k: 1 }, 2, 3]],
  [holeInTheMiddle, [1, , 3]], [textAtTheEndOfManyOntoMany, [...many, "t"]], [minusZeroAtTheEnd, [1, 2, -0]], [largeNumberAtTheEnd, [1, 2, 2 ** 31]], [strangerInTheThirdTurn, [[2, 3], [4], [5, "t"], [6]]],
]) {
  const kinds = new Set();
  let last;
  for (let turn = 0; turn < 60; turn++) kinds.add(storageOf((last = run(items))));
  console.log(run.name, [...kinds].join(" then "), last.length, JSON.stringify(last), Object.is(last[last.length - 1], -0));
}
const scale = partial(line, 3, 4);
let sum = 0;
for (let x = 0; x < 3000; x++) sum += scale(x);
console.log(sum, partial(line)(1, 2, 3), partial(line, 1, 2, 3)(), partial((...all) => all.join(), 1, "t")(2.5, undefined));
