function Base(a, b) { this.a = a; this.b = b === undefined ? "none" : b; this.viaNew = new.target !== undefined && new.target.name; }
Base.prototype.j = function () { return this.a; };
class B extends Base { k() { return this.j() + 1; } }
class C extends B { }
globalThis.kept = [Base, B, C];
function run(n) { let t = 0, last; for (let i = 0; i < n; i++) { last = i % 2 ? new B(i) : new C(i, i); t += last.k(); } return t + " " + last.b + " " + last.viaNew + " " + (last instanceof Base); }
console.log(run(30001), run(30000));
