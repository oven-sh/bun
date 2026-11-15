// `list.push(a, ...other)`: the receiver's storage is what a push one by one gives it: whole numbers leave a list of whole numbers as it is, a fraction makes it a list of fractions, a text a list of values. Each case has a function of its own: every literal and every call sees one kind.
const { describe } = require("bun:jsc");
const storageOf = list => /ArrayWith[A-Za-z0-9]+/.exec(describe(list))?.[0];
function wholeIntoWhole(items) { const out = [0]; out.push(...items); return out; }
function wholeBehindOneIntoWhole(items) { const out = [0]; out.push(7, ...items); return out; }
function wholeBehindTwoIntoWhole(items) { const out = [0]; out.push(7, 8, ...items); return out; }
function fractionsIntoWhole(items) { const out = [0]; out.push(...items); return out; }
function fractionsBehindOneIntoWhole(items) { const out = [0]; out.push(7, ...items); return out; }
function numbersBehindOneIntoWhole(items) { const out = [0]; out.push(7, ...items); return out; }
function wholeBehindAFractionIntoWhole(items) { const out = [0]; out.push(7.5, ...items); return out; }
function wholeBehindOneIntoFractions(items) { const out = [0.5]; out.push(7, ...items); return out; }
function textsBehindOneIntoWhole(items) { const out = [0]; out.push(7, ...items); return out; }
function wholeBehindATextIntoWhole(items) { const out = [0]; out.push("t", ...items); return out; }
function wholeInTurns(items) { const out = []; for (let turn = 0; turn < 3; turn++) out.push(turn, ...items); return out; }
const whole = Array.from({ length: 40 }, (_, i) => i);
const fractions = whole.map(n => n + 0.5);
const numbers = whole.map(n => (n % 2 ? n : n + 0.5));
const texts = whole.map(String);
for (const [run, items] of [
  [wholeIntoWhole, whole], [wholeBehindOneIntoWhole, whole], [wholeBehindTwoIntoWhole, whole], [fractionsIntoWhole, fractions], [fractionsBehindOneIntoWhole, fractions],
  [numbersBehindOneIntoWhole, numbers], [wholeBehindAFractionIntoWhole, whole], [wholeBehindOneIntoFractions, whole], [textsBehindOneIntoWhole, texts], [wholeBehindATextIntoWhole, whole], [wholeInTurns, whole],
]) {
  const kinds = new Set();
  let last;
  for (let turn = 0; turn < 80; turn++) kinds.add(storageOf((last = run(items))));
  console.log(run.name, [...kinds].join(" then "), last.length, String(last[1]), String(last[last.length - 1]));
}
