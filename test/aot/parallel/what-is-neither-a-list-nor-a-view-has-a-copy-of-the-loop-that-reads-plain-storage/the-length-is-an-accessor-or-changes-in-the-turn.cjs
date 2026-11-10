// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 1
"use strict";
// The length is a getter that counts its calls and shrinks, lies on the prototype, is a fraction, a text, NaN, negative or absent; a getter under an index changes it in the middle of the loop.
const said = [];
function sum(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
let asked = 0;
for (let round = 0; round < 3; round++) {
    const counted = fresh(); delete counted.length; asked = 0; Object.defineProperty(counted, "length", { get() { asked++; return 4 - (asked > 2 ? 2 : 0); }, configurable: true }); said.push(sum(counted), asked);
    const inherited = fresh(); delete inherited.length; Object.setPrototypeOf(inherited, { length: 3 }); said.push(sum(inherited));
    for (const length of [2.5, "3", NaN, -1, 0, -0, null, undefined, true, { valueOf() { asked++; return 2; } }]) { const holder = fresh(); holder.length = length; said.push(String(sum(holder))); }
    const none = fresh(); delete none.length; said.push(sum(none));
    const shrinks = fresh(); Object.defineProperty(shrinks, 1, { get() { shrinks.length = 2; return 5; }, configurable: true }); said.push(sum(shrinks));
    const grows = fresh(); grows[4] = 11; Object.defineProperty(grows, 0, { get() { grows.length = 5; return 3; }, configurable: true }); said.push(sum(grows));
}
console.log(said.join(" "));
