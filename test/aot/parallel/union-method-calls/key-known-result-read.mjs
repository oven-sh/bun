// The same, and its result is read.
class A { step(k) {} }
class B { step(k) {} }
function work(list, key) { const out = []; const one = (o, i) => { if (i === 2) delete A.prototype.step; out.push(o[key](i)); }; for (let i = 0; i < 6; i++) one(list[i % list.length], i); return out.join(); }
function other(list) { const out = []; for (let i = 0; i < 5; i++) { try { out.push(list[i & 1].step('1')); } catch (e) { out.push(e.name); } } return out.join(); }
for (let round = 0; round < 2; round++) { try { console.log(work([new A(), new B()], 'st' + 'ep')); } catch (e) { console.log(e.name); } }
console.log(other([new B(), new A()]));
