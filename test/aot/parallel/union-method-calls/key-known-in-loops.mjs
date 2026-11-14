// A method that several classes have, called under a key that is known where it is walked: the call finds the read that was left to it.
class A { step(k) {} }
class B { step(k) {} }
function work(list, key) { const out = []; const one = (o, i) => { try { if (i === 2) Object.defineProperty(B.prototype, 'step', { configurable: true, get: () => k => k + 0.25 }); out.push(o[key](i)); } catch (e) { out.push(e.name); } }; for (let i = 0; i < 6; i++) one(list[i % list.length], i); return out.join(); }
function other(list) { const out = []; for (let i = 0; i < 5; i++) { try { out.push(list[i & 1].step('1')); } catch (e) { out.push(e.name); } } return out.join(); }
for (let round = 0; round < 2; round++) { try { console.log(work([new A(), new B()], 'st' + 'ep')); } catch (e) { console.log(e.name); } }
console.log(other([new B(), new A()]));
