// Each name below is stored once, and what it holds is made by the text of this file: a call of a function that stands here, a literal, an instance of a class of the file.
'use strict';
function peg(hung) { return { now: hung, worn: 0 }; }
class Rail { constructor() { this.now = 0; this.below = []; } }
const coats = peg('none'), hats = peg(0), rail = new Rail(), shelf = { now: null, box: { now: 1 } }, piled = [], keys = [peg(1), peg(2.5)];
let depth = -1;
exports.hang = function (coat, hat) { piled.push(coats.now); depth++; rail.below[depth] = hats.now; coats.now = coat; hats.now = hat; coats.worn += 1; rail.now++; };
exports.take = function () { if (depth < 0) return 'empty'; const was = coats.now; coats.now = piled.pop(); hats.now = rail.below[depth]; rail.below[depth] = undefined; depth--; rail.now -= 1; return was; };
exports.look = function () { return coats.now + '|' + hats.now + '|' + coats.worn + '|' + rail.now + '|' + shelf.now + '|' + shelf.box.now + '|' + keys.map(k => k.now).join('+'); };
exports.shelve = function (thing) { const was = shelf.now; shelf.now = thing; shelf.box.now += typeof thing === 'number' ? thing : 1; return was; };
exports.turn = function (n) { let sum = 0; for (let i = 0; i < n; i++) { keys[i & 1].now += rail.now; sum += keys[i % keys.length].now; } return sum; };
exports.pegs = { coats, hats, rail, shelf, keys };
