"use strict";
// -2147483648 / -1 | 0 is -2147483648, and the remainder beside it is -0: a wrapped quotient is none that a remainder can be made of, where the divisor is wider than an int32.
const numbers = JSON.parse("[-2147483648, 0, -1, 5, 2147483647, -7, 3, 1, 2147483648, 4294967295, 4294967296]");
const shown = number => Object.is(number, -0) ? "-0" : String(number);
function quotientFirst(a, b) { const x = a | 0, y = (b >>> 0) - 1, quotient = (x / y) | 0, remainder = x % y; return shown(quotient) + " " + shown(remainder); }
function remainderFirst(a, b) { const x = a | 0, y = (b >>> 0) - 1, remainder = x % y, quotient = (x / y) | 0; return shown(quotient) + " " + shown(remainder); }
function ofWords(a, b) { const x = a | 0, y = b | 0, quotient = (x / y) | 0, remainder = x % y; return shown(quotient) + " " + shown(remainder); }
function inLoop(list, b) { const y = (b >>> 0) - 1, out = []; for (let i = 0; i < list.length; i++) { const x = list[i] | 0, quotient = ~~(x / y), remainder = x % y; out.push(shown(quotient), shown(remainder)); } return out.join(); }
function divisorsInLoop(a, b) { const x = a | 0, y = (b >>> 0) - 2, out = []; for (let i = 0; i < 3; i++) { const z = y + i, quotient = (x / z) | 0, remainder = x % z; out.push(shown(quotient), shown(remainder)); } return out.join(); }
for (const a of numbers) for (const b of numbers) console.log(a, b, quotientFirst(a, b), remainderFirst(a, b), ofWords(a, b), divisorsInLoop(a, b));
for (const b of numbers) console.log(b, inLoop(numbers, b));
