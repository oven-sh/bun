const Meter = (() => { class Meter { constructor(a) { this.a = a; } twice() { return this.a * 2; } } return Meter; })();
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Meter(i).twice(); return t; }
console.log(run(4), Meter.name, new Meter(1) instanceof Meter);
