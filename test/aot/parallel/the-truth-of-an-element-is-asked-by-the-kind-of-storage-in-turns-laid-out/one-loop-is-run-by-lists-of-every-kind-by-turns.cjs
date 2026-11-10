// STATISTIC: UnrolledLoopRawTruthinessTests >= 2
// STATISTIC: UnrolledLoopsForInt32Truthiness >= 1
"use strict";
// The same loop is run by a list of whole numbers, of doubles, of values, one gone sparse, one frozen, a copy-on-write literal, a view, an arguments object and an object with places, by turns; and a list changes its kind between two calls.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function count(list) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) c = (c + 1) | 0; } return c; }
function handed() { return count(arguments); }
for (let round = 0; round < 3; round++) {
    const whole = JSON.parse("[1,0,2,0,3]"), doubles = JSON.parse("[1.5,0,2.5,0,3.5]"), values = JSON.parse('[1,"",null,"a",0.5]'), sparse = JSON.parse("[1,0,2]"); sparse[100000] = 1;
    said.push(count(whole), count(doubles), count(values), count(sparse), count(Object.freeze(JSON.parse("[0,1,0]"))), count(veil([0, 1, 2, 0])), count(veil([0.5, 0, 1.5])), count(veil(new Uint8Array([0, 1, 0, 2]))), count(veil(new Float64Array([0, NaN, -0, 2]))), handed(0, 1, "", "a"), count(JSON.parse('{"length":3,"0":0,"1":1,"2":2}')), count(veil("a0")));
    whole[1] = 0.5; said.push(count(whole)); whole[3] = veil("x"); said.push(count(whole)); doubles[1] = veil(""); said.push(count(doubles)); doubles[3] = veil({}); said.push(count(doubles));
}
console.log(said.join(" "));
