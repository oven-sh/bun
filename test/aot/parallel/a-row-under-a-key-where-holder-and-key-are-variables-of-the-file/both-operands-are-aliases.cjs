"use strict";
// `for (..; i < data[w].length; ..) s = s + data[w][i]` where `data` and `w` are variables of the file: the row under the key is found in front of the loop. A read that is walked goes by what its operands were bound to when they
// were read, never by what a variable holds by then. HERE: both operands are aliases of variables that are stored back.
const box = JSON.parse('{"name":"rows","second":"other","holder":{"rows":[1,2,3,4,5,6,7,8,9,10,11,12],"other":[100,200,300]},"spare":{"rows":[50,60,70,80,90,100],"other":[7,7]}}');
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
const data = box.holder, w = box.name, spare = box.spare, otherKey = box.second;
let cursor = data, cursorKey = w;
function sums() { let s = 0, n = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; cursor = spare; cursorKey = otherKey; const second = cursor, secondKey = cursorKey; cursor = data; cursorKey = w; n = n + second[secondKey].length; } return s * 1000 + n; }
console.log("SAID first " + tried(sums));
console.log("SAID second " + tried(sums));
