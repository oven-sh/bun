const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
function inner() { if (process.argv.length < 99) throw new Error('stop'); Gauge.prototype.next = function () { return this.v + 1; }; }
function outer() { inner(); }
try { outer(); } catch (e) { }
console.log(attempt(() => read(Gauge)));
