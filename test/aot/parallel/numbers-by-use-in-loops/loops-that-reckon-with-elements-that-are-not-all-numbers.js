// Lists out of texts whose elements are not all numbers go through loops that reckon with them: booleans, a null in every third place, a text at every ninth, numbers alone, and lists that change kind between calls.
const make = (n, at) => JSON.parse("[" + Array.from({ length: n }, (_, i) => JSON.stringify(at(i))).join() + "]");
const flags = make(64, i => i % 3 > 0), gaps = make(64, i => i % 3 ? i + 0.5 : null), texts = make(64, i => i % 9 ? i : String(i)), numbers = make(64, i => i + 0.25), wholes = make(64, i => i);
function times(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; sum = sum + v * 2; } return sum; }
function plus(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; sum = sum + +v; } return sum; }
function less(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; sum = sum + (v - 1) * (v - 2); } return sum; }
function bits(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; sum = (sum + (v | 0) * 3) | 0; } return sum; }
for (let round = 0; round < 3; round++) {
  for (const list of [flags, gaps, texts, numbers, wholes]) console.log(round, times(list), plus(list), less(list), bits(list));
  numbers[round * 7] = round ? null : true;
  wholes[round * 5] = "7";
}
