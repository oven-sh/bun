// Each evaluation of a class has names of its own, and all of them share one layout: the layout is no brand.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function make(tag) { return class K { #x = tag; #m() { return tag; } static get(o) { return o.#x; } static set(o, v) { o.#x = v; } static has(o) { return #x in o; } static call(o) { return o.#m(); } me() { return this.#x; } }; }
function attempt(f) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
const K1 = make(1);
const K2 = make(2);
const a = new K1;
const b = new K2;
for (let round = 0;round < 3; round++) { attempt(() => K1.get(a)); attempt(() => K1.get(b)); attempt(() => K2.get(a)); attempt(() => K2.get(b)); attempt(() => K1.has(a)); attempt(() => K1.has(b)); attempt(() => K2.has(a)); attempt(() => K2.has(b)); attempt(() => K1.set(b, 9)); attempt(() => K2.set(b, 9 + round)); attempt(() => K2.get(b)); attempt(() => K1.call(a)); attempt(() => K1.call(b)); attempt(() => a.me()); attempt(() => b.me()); }
const classes = [];
for (let i = 0;i < 4; i++) classes[i] = class L { #v = i; static get(o) { return o.#v; } };
let text = "";
for (let i = 0;i < 4; i++) { for (let j = 0;j < 4; j++) { try { text += classes[i].get(new classes[j]); } catch { text += "x"; } } }
report(text);
const mixin = (Base) => class extends Base { #tag = 1; tag() { return this.#tag++; } };
class P { }
class Q { }
const MP = mixin(P);
const MQ = mixin(Q);
const mp = new MP;
const mq = new MQ;
attempt(() => mp.tag() + mp.tag());
attempt(() => mq.tag());
const crossed = Object.create(mq);
crossed.tag = MP.prototype.tag;
attempt(() => crossed.tag());
const swapped = mq;
swapped.other = MP.prototype.tag;
attempt(() => swapped.other());
swapped.same = MQ.prototype.tag;
attempt(() => swapped.same());
report("end");
