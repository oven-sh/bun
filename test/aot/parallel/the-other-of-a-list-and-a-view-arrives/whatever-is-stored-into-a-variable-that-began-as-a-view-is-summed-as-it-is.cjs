"use strict";
let held = new Float64Array(6);
function load(rows) { held = rows; }
function summed() { let s = 0; for (let i = 0; i < held.length; i++) s = s + held[i] * 2; return s; }
const parsed = JSON.parse('{"fractions":[0.5,1.5,2.5,3.5],"whole":[1,2,3,4],"mixed":[1,"2",3.5,null],"texts":["a","b"],"empty":[]}');
const holed = [0.5, 1.5, 2.5]; delete holed[1];
const holedAtFirst = [1.5, 2.5, 3.5]; delete holedAtFirst[0];
const sparse = [1, 2]; sparse[5000] = 3;
const frozen = Object.freeze([4.5, 5.5]);
const withGetter = [1, 2, 3]; Object.defineProperty(withGetter, 1, { get() { return 40; } });
class Rows extends Array {}
const heir = Rows.from([1.5, 2.5]);
const arrivals = [
  ["a view of doubles", Float64Array.of(0.5, 1.5, 2.5)], ["fractions", parsed.fractions], ["whole numbers", parsed.whole], ["the view again", Float64Array.of(7.25)],
  ["mixed", parsed.mixed], ["texts", parsed.texts], ["nothing in it", parsed.empty], ["a hole", holed], ["sparse", sparse], ["frozen", frozen], ["a getter", withGetter], ["an heir", heir],
  ["floats", Float32Array.of(0.5, 1.5)], ["bytes", Uint8Array.of(1, 2, 3)], ["big ones", { length: 2, 0: 3, 1: 4 }], ["a text", "123"], ["fractions again", parsed.fractions],
];
for (let round = 0; round < 3; round++) {
  for (const [name, rows] of arrivals) { load(rows); console.log(round, name, summed()); }
}
load(holedAtFirst); console.log("a hole at the first place", summed());
for (const rows of [undefined, null]) { load(rows); try { console.log(summed()); } catch (error) { console.log(error.constructor.name); } }
