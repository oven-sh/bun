// Records of JSON.parse go through small functions in loops of a file whose literals copy their names.
// STATISTIC: LoopsReversionedWithoutNameGuesses >= 1
const turns = JSON.parse("30");
const record = i => JSON.parse(`{"id":${i},"x":${i / 3 + 0.5},"y":${0.1 + i},"n":${i % 7}}`);
const list = Array.from({ length: 50 }, (_, i) => record(i));
const reply = ({ id, x, y, n }) => ({ id, x, y, n, ok: n > 3 });
console.log(JSON.stringify(list.slice(0, 2).map(reply)));
function area(o, k) { return o.x * o.y * k; }
function step(o, dt) { o.x += o.y * dt; }
function areas(l) { let a = 0; for (const o of l) a += area(o, 2); return a; }
function stepped(l) { for (let i = 0; i < l.length; i++) { const o = l[i]; step(o, 0.016); } return l[3].x; }
function taken(l) { let a = 0; for (const { x, y, n } of l) a += x * y + n; return a; }
function nested(l) { let a = 0; for (let j = 0; j < 2; j++) for (const o of l) a += o.x * o.y + j; return a; }
let s = 0;
for (let t = 0; t < turns; t++) s += areas(list) + stepped(list) + taken(list) + nested(list);
console.log(s);
const replies = list.slice(5, 25).map(reply), both = [record(1), reply(record(2)), record(3), reply(record(4)), { x: "2", y: 3, n: 1 }, Object.freeze(reply(record(5)))];
for (let t = 0; t < turns; t++) s += areas(replies) + stepped(replies) + taken(replies) + nested(replies);
console.log(s);
for (let t = 0; t < turns; t++) { const line = [areas(both), stepped(both.slice(0, 5)), nested(both), areas(list)].join(); if (t % 10 === 0) console.log(line); if (t === 12) { both[0] = reply(record(6)); list[4] = reply(list[4]); } }
console.log(areas(list), taken(replies), both.map(o => String(o.x)).join());
