// The list that arrives is made of such literals in sight: what is seen to arrive stays expected.
// STATISTIC: UnescapedShapesDroppedForElements = 0
'use strict';
function shift(list, by) { for (let i = 0; i < list.length; i++) { const c = list[i]; c.sink += 9.8 * by; c.wide += c.drift * by; c.tall += c.sink * by; if (c.tall > 40) { c.tall = 40; c.sink = -c.sink * 0.9 - 1; } } }
function tell(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].wide * 3 + list[i].tall * 5 + list[i].sink * 7; return sum.toFixed(6) + ' ' + Object.keys(list[0]).join() + ' ' + JSON.stringify(list[list.length - 1]); }
function make() { const list = []; for (let i = 0; i < 24; i++) list.push({ wide: i + 0.5, tall: i * 0.5 + 0.25, drift: i * 0.25 + 0.125, sink: 0.5 }); return list; }
const made = make();
for (let turn = 0; turn < 40; turn++) shift(made, 0.02);
console.log(tell(made));
