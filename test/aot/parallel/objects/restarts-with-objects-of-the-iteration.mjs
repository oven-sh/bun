// An iteration of the outer loop allocates the objects that it stores into, and restarts. CheckEffects counts no store into an object of the iteration.
class A { constructor() { this.t = 0; } step(k) { this.t += k; return 'A' + k; } }
class B { constructor() { this.t = 1; } step(k) { this.t -= k; return 'B' + k; } }
function ask(o, key, i) { if (i === 2) B.prototype.step = k => 's' + k; return o[key](i); }
function work(list, key) { let s = ''; for (let i = 0; i < 6; i++) s += ask(list[i % list.length], key, i); return s; }
function other(list) { const out = []; for (let i = 0; i < 5; i++) { try { out.push(list[i & 1].step('1')); } catch (e) { out.push(e.name); } } return out.join(); }
for (let round = 0; round < 2; round++) { try { console.log(work([new A(), new B()], 'st' + 'ep')); } catch (e) { console.log(e.name); } }
console.log(other([new B(), new A()]));
