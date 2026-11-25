const log = [];
function P(a, b) { this.a = a; this.b = b; }
Object.defineProperty(P.prototype, "a", { set(v) { log.push(typeof this.b, Object.keys(this).join()); this.kept = v; }, get() { return this.kept; }, configurable: true });
function read(p) { return p.b + 1; }
let t = 0;
for (let i = 0; i < 20; i++)
    t += read(new P(i, i));
console.log(t, log[0], "[" + log[1] + "]", log.length);
