function Counter() { }
Counter.prototype.n = 0;
Counter.prototype.bump = function () { this.n++; return this.n; };
function run(n) { const out = []; const c = new Counter(); for (let i = 0; i < n; i++) { if (i === 2) Object.defineProperty(Counter.prototype, "n", { writable: false }); out.push(c.bump(), new Counter().bump()); } return out.join(" "); }
console.log(run(4), Counter.prototype.n);
