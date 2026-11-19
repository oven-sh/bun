"use strict";
// The field is held to numbers, texts and nothing; the turn adds an element that is a number or missing. In the loop the field is expected to hold a number: the sum is reckoned in numbers behind one test, and a text, undefined, null or a truth value in the field takes the other arm, turn by turn.
const key = JSON.parse('"add"');
class Sum { constructor(start) { this.total = start; this.n = 0; } add(s) { for (let i = 0; i < s.length; i++) this.total += s[i]; return this.total; } }
const starts = () => [0, 1.5, -0, NaN, "", "t", undefined, null, JSON.parse("7"), JSON.parse('"x"')];
const lists = () => [JSON.parse("[1.5,2.25,3]"), JSON.parse("[1,2,3]"), [1, , 3], [], [0.5], [-0], [1e308, 1e308], new Float64Array([0.5, 1.5]), new Uint8Array([1, 2])];
const show = v => Object.is(v, -0) ? "-0" : typeof v + " " + String(v);
for (const start of starts()) for (const s of lists()) { const sum = new Sum(start); for (let turn = 0; turn < 3; turn++) console.log(show(sum[key](s))); }
const late = new Sum(0), numbers = JSON.parse("[1,2,3]");
for (const put of [1, "a", 2, undefined, 3, null, 4]) { late.total = put; console.log(show(late[key](numbers))); }
