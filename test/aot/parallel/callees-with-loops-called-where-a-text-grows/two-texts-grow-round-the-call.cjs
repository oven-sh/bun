"use strict";
const rows = JSON.parse('[{"x":3},{"x":4},{"x":5},{"x":6}]');
const upTo = JSON.parse("[0,1,2,3,4]");
function gather() { let sum = 0; for (let at = 0; at < arguments.length; at++) { sum += arguments[at]; } return sum; }
function grow(t) { let left = "", right = ""; for (let i = 0; i < upTo[4]; i++) { left += "<" + i; const got = gather(rows[i].x, i, t); right += got + ">"; } return left + right; }
for (let t = 0; t < 3; t++) console.log(grow(t));
