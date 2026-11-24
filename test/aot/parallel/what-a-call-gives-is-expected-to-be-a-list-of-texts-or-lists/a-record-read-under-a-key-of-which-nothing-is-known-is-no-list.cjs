// `data[w][i]`: w comes out of a parse: nothing says that it is a number but that what it finds is read under one. data is a record: it gets no word of a list.
"use strict";
const data = JSON.parse('{"rows":[1,2,3,4,5,6,7,8,9,10,11,12],"name":"abc"}'), w = JSON.parse('"rows"'), n = JSON.parse('"name"');
const into = { sum: 0, text: "" };
function add() { for (let i = 0; i < 12; i++) into.sum += data[w][i]; return into.sum; }
function join() { let s = ""; for (let i = 0; i < 3; i++) if (data[n][i] > "a") s += data[n][i]; return s; }
let last = 0;
for (let t = 0; t < 200; t++) last = add();
console.log(last, join());
