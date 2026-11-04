class A { constructor(x) { if (x % 1000 === 7) throw new RangeError("at " + x); this.x = x; } }
class B extends A { f = 1; }
class N extends null { }
globalThis.kept = [A, B, N];
function run(n) { let t = 0, caught = 0; for (let i = 0; i < n; i++) { try { t += new B(i).x + 1; } catch (e) { caught += e instanceof RangeError ? e.message.length : 1000; } } return t + " " + caught; }
console.log(run(30000));
function none(n) { let s = ""; for (let i = 0; i < n; i++) { try { new N(i); s = "made"; } catch (e) { s = e.constructor.name; } } return s; }
console.log(none(2000));
try { B(1); } catch (e) { console.log(e.constructor.name); }
