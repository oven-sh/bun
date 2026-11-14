// Functions that a generator hands on get names late; reads of the names in copied callees.
function* each(list) { for (const item of list) yield item; }
function make(n) { const f = x => x + n; return f; }
const list = [make(1), make(2), make(3)];
const sum = (o, q) => o.a + q.a;
let i = 0;
for (const f of each(list)) f.a = ++i;
let t = 0;
for (let k = 0; k < 40; k++) for (const f of each(list)) t += sum(f, list[k % 3]) + f(k);
console.log(t);
function Holder() {}
function late(h) { return h.value + (h.more ?? 0); }
console.log(Number.isNaN(late(Holder)));
for (const h of each([Holder])) { h.value = 4; console.log(late(h), late(Holder)); h.more = 0.5; }
let s = 0;
for (let k = 0; k < 20; k++) for (const h of each([Holder, Holder])) s += late(h);
console.log(s);
Holder.value = "text";
console.log(late(Holder), sum({ a: 1 }, list[0]));
