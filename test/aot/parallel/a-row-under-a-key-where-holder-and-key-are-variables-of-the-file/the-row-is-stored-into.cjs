"use strict";
// `for (..; i < data[w].length; ..) s = s + data[w][i]` where `data` and `w` are variables of the file: they are read in front of the loop, their dead zones asked there, and the row under the key is found in front as it is
// for parameters. Whatever the variables hold and whoever stores them, the answer is plain's. HERE: the turn stores numbers into the row.
const box = JSON.parse('{"name":"rows","second":"other","holder":{"rows":[1,2,3,4,5,6,7,8,9,10,11,12],"other":[100,200,300]},"spare":{"rows":[50,60,70,80,90,100],"other":[7,7]}}');
let counted = 0;
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
const data = box.holder, w = box.name;
function row() { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; data[w][i] = data[w][i] + 2; } return s; }
console.log(tried(row), counted, tried(row), counted, JSON.stringify(box.holder));

