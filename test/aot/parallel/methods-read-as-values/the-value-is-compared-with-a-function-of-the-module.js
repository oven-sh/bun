// `o.s === shared`: a function of the module lies under a name on the prototype, beside a method that the class declares
function shared() { return this.n; }
class A { constructor() { this.n = 1; } m() { return 0; } }
A.prototype.s = shared;
function run(o, turns) { let said = ""; for (let i = 0; i < turns; i++) said = "" + (o.s === shared) + (o.m === shared) + (o.m === A.prototype.m) + o.s(); return said; }
console.log(run(new A(), 5));
