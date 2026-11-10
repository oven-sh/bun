// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 1
"use strict";
// An index of the holder becomes an accessor: the getter runs once for each read, in its turn, and may change the holder; a setter alone reads as undefined.
const said = [];
function sum(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
let ran = 0;
for (let round = 0; round < 3; round++) {
    const plain = fresh(); said.push(sum(plain));
    const got = fresh(); Object.defineProperty(got, 1, { get() { ran++; return 100 + ran; }, configurable: true }); said.push(sum(got), ran);
    const changes = fresh(); Object.defineProperty(changes, 0, { get() { changes[2] = 70; changes.length = 3; return 1; }, configurable: true }); said.push(sum(changes));
    const set = fresh(); Object.defineProperty(set, 2, { set(v) { ran += v; }, configurable: true }); said.push(String(sum(set)));
    const back = fresh(); Object.defineProperty(back, 3, { get() { return 1; }, configurable: true }); Object.defineProperty(back, 3, { value: 11, writable: true, enumerable: true, configurable: true }); said.push(sum(back));
}
console.log(said.join(" "));
