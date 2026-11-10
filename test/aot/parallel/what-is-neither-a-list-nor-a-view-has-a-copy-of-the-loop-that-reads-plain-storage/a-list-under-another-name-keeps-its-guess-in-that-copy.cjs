// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 1
// STATISTIC: LoopsWithCopyForWhatIsNeitherListNorView >= 1
"use strict";
// Two holders stand in one loop. Of the first nothing is known: it has failed every test in front and runs the copy for what is neither a list nor a view. The second is a list wherever the file calls.
// In that copy the door against guesses at built-in classes is shut for the first alone: the second is asked for a list as everywhere, and once it is none.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
function weigh(like, weights) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j] * weights[j]; return s; }
for (let round = 0; round < 3; round++) said.push(weigh(fresh(), [1, 2, 3, 4]), weigh(fresh(), [0.5, 1.5, 2.5, 3.5]), weigh(veil([1, 2, 3]), [4, 5, 6]), String(weigh(fresh(), [1, 2])), weigh(veil(new Uint8Array([7, 8])), [1, 2]));
console.log(said.join(" "));
