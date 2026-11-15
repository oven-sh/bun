"use strict";
const rows = JSON.parse('[{"x":3},{"x":4},{"x":5},{"x":6}]');
const upTo = JSON.parse("[0,1,2,3,4]");
function gather() { let sum = 0; for (let at = 0; at < arguments.length; at++) { if (arguments[at] === 5) throw new RangeError("five"); sum += arguments[at]; } return sum; }
function grow(t) { let text = ""; for (let i = 0; i < upTo[4]; i++) { try { text += "|" + gather(i, rows[i].x, t); } catch (error) { text += "!" + error.message; } } return text; }
for (let t = 0; t < 3; t++) console.log(grow(t));
