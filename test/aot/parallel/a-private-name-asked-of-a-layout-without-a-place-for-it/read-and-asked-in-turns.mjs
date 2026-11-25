class P { #x; constructor(x) { this.#x = x; } static is(o) { return #x in o; } static get(o) { return o.#x; } }
class H extends P { z = 1; } class Q { y = 2; }
const all = [new P(1), new H(2), new Q(), new H(3), new Q(), new P(4)]; let s = 0; const errors = [];
for (let turn = 0; turn < 4; turn++) for (const o of all) { if (P.is(o)) s += P.get(o); else { try { P.get(o); } catch (e) { errors.push(e.name); } } }
console.log(s, errors.length, errors[0]);
