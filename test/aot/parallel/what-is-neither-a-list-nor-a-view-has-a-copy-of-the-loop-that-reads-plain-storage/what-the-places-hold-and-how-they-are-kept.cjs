// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 1
"use strict";
// The places hold int32s, fractions, -0, NaN, texts, objects with valueOf, undefined, null, big integers and holes; the storage turns from one kind into another between the calls and grows past its room.
const said = [];
// What goes through here comes back as it is, and nothing is known of it in the build.
function veil(value) { return JSON.parse("0", () => value); }
function sum(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
function attempt(like) { try { return sum(like); } catch (error) { return error.name; } }
for (let round = 0; round < 3; round++) {
    const holder = fresh(); said.push(sum(holder));
    holder[1] = 0.5; said.push(sum(holder)); holder[2] = NaN; said.push(String(sum(holder))); holder[2] = -0; holder[0] = -0; holder[1] = -0; holder[3] = -0; said.push(Object.is(sum(holder), 0) ? "zero" : "other");
    holder[0] = veil("a"); said.push(sum(holder)); holder[1] = veil({ valueOf() { return 40; } }); said.push(sum(holder)); holder[2] = veil(undefined); said.push(String(sum(holder))); holder[2] = veil(null); said.push(sum(holder));
    const big = fresh(); big[0] = veil(1n); said.push(attempt(big));
    const grown = fresh(); for (let at = 4; at < 200; at++) grown[at] = at; grown.length = 200; said.push(sum(grown));
    const far = fresh(); far[1000000] = 1; said.push(sum(far)); far.length = 3; said.push(sum(far));
    const doubles = JSON.parse('{"length":3,"0":0.5,"1":1.5,"2":2.5}'); said.push(sum(doubles)); delete doubles[1]; said.push(String(sum(doubles))); doubles[1] = veil("x"); said.push(sum(doubles));
}
console.log(said.join(" "));
