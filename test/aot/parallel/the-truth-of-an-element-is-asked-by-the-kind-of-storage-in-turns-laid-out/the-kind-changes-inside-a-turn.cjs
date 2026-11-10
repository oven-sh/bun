"use strict";
// The turn itself stores what the storage cannot hold, a callee does, the list grows or is cut in the turn: the places that follow are asked as they then lie.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function storesFraction(list) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) { c = (c + 1) | 0; if (i === 1) list[3] = 0.5; } } return c; }
function storesText(list, text) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) { c = (c + 1) | 0; if (i === 1) list[3] = text; } } return c; }
function calls(list, each) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) c = (c + each(list, i)) | 0; } return c; }
function cuts(list) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) { c = (c + 1) | 0; if (i === 1) list.length = 3; } } return c; }
function grows(list) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) { c = (c + 1) | 0; if (i < 3) list.push(i & 1); } } return c; }
const ways = veil([(list, i) => { if (i === 0) list[2] = ""; return 1; }, (list, i) => { if (i === 0) list[2] = 0.25; return 1; }, (list, i) => { if (i === 0) delete list[2]; return 1; }]);
for (let round = 0; round < 3; round++) {
    said.push(storesFraction(JSON.parse("[1,2,3,0,5]")), storesFraction(JSON.parse("[1.5,2.5,3.5,0,5.5]")), storesText(JSON.parse("[1,2,3,0,5]"), veil("")), storesText(JSON.parse("[1,2,3,0,5]"), veil("a")), storesText(JSON.parse("[1.5,2.5,3.5,0,5.5]"), veil("a")));
    for (const way of ways) said.push(calls(JSON.parse("[1,2,3,4]"), way), calls(JSON.parse("[1.5,2.5,3.5,4.5]"), way));
    said.push(cuts(JSON.parse("[1,2,3,4,5]")), cuts(JSON.parse("[1.5,2.5,3.5,4.5]")), grows(JSON.parse("[1,2,3]")), grows(JSON.parse("[1.5,2.5,3.5]")));
}
console.log(said.join(" "));
