class P { #x = 1; static is(o) { return #x in o; } }
class H extends P { z = 3; } class HH extends H { #x = 5; static own(o) { return #x in o; } }
class Q { y = 2; } class QQ extends Q { w = 1; }
const all = [new P(), new H(), new HH(), new Q(), new QQ(), {}, [], () => 1, new Map(), Object.create(null), Object.create(new P())];
const out = []; for (let turn = 0; turn < 3; turn++) for (const o of all) out.push((P.is(o) ? 1 : 0) + (HH.own(o) ? 2 : 0));
console.log(out.join(""));
