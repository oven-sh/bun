// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 1
"use strict";
// A place of the holder is empty: what lies under that index on an object above it answers: a number, a getter, nothing; the object above is changed between the calls.
const said = [];
function sum(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
for (let round = 0; round < 3; round++) {
    const above = { 1: 50 }; const holed = fresh(); delete holed[1]; said.push(String(sum(holed)));
    Object.setPrototypeOf(holed, above); said.push(sum(holed));
    above[1] = 60; said.push(sum(holed));
    Object.defineProperty(above, 1, { get() { return 70 + this.length; }, configurable: true }); said.push(sum(holed));
    delete above[1]; said.push(String(sum(holed)));
    const short = fresh(); short.length = 6; Object.setPrototypeOf(short, { 4: 1, 5: 2 }); said.push(sum(short));
    const none = Object.assign(Object.create(null), fresh()); said.push(sum(none)); delete none[0]; said.push(String(sum(none)));
}
console.log(said.join(" "));
