// STATISTIC: LoopsWithCopyForWhatIsNeitherListNorView = 1
// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 1
"use strict";
// Two loops over a holder of which nothing is known. The turns of the first call nothing: what is neither a list nor a view has a copy of it.
// The turns of the second call what nobody knows: there no read could ask its site or its storage, the copy would be one more walk of the loop as written, and it is not laid.
const said = [];
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
function quiet(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
function calling(like, each) { let s = 0; for (let j = 0; j < like.length; j++) s += each(like[j]) * 2; return s; }
const ways = JSON.parse("[0, 1]").map(which => which ? value => value * 2 : value => value + 1);
for (let round = 0; round < 3; round++) said.push(quiet(fresh()), quiet([1, 2, 3]), calling(fresh(), ways[round & 1]), calling([1, 2, 3], ways[round & 1]), calling(new Uint8Array([4, 5]), ways[round & 1]));
console.log(said.join(" "));
