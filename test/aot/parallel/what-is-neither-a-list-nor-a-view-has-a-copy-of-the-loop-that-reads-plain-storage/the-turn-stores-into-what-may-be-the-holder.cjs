"use strict";
// The text of the turn stores into a second value that is by turns the holder itself, another object, a list and a view: elements, the length by name, and a field named length of an object that the file writes out.
const said = [];
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
function element(like, other) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j]; other[j + 1] = 100; } return s; }
function named(like, other) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j]; if (j === 0) other.length = 2; } return s; }
function written(like, box) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j] === undefined ? 1000 : like[j]; box.length = 2; } return s; }
for (let round = 0; round < 3; round++) {
    const same = fresh(); said.push(element(same, same), element(fresh(), fresh()), element(fresh(), [1, 2]), element(fresh(), new Uint8Array(8)));
    const also = fresh(); said.push(named(also, also), named(fresh(), fresh()), named(fresh(), [1, 2, 3]));
    const box = { length: 4, 0: 3, 1: 5, 2: 7, 3: 9 }; said.push(written(box, box), written(fresh(), { length: 9, 0: 1 }), written({ length: 3, 0: 1, 1: 2, 2: 3 }, { length: 0 }));
}
console.log(said.join(" "));
