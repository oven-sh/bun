class A { constructor() { this.x = 1; } m() { return "A.m"; } }
function Alias() { this.f = 2; }
Alias.prototype = A.prototype;
function show(v) { return v.x + " " + v.f + " " + v.extra + " " + v.m() + " " + Object.keys(v).join() + " " + (v instanceof A) + " " + (v instanceof Alias); }
const a = new A(), alias = new Alias();
alias.extra = 3;
console.log(show(a)); console.log(show(alias));
class Over extends Alias { g = 4; }
const over = new Over();
console.log(show(over), over.g);
