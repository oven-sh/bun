// Two constructors with ONE prototype object: an instance of either is an instance of both, and finds the members of that object.
const shared = { m() { return "shared.m"; } };
function F() { this.f = 1; }
function G() { this.g = 2; }
F.prototype = shared;
G.prototype = shared;
function show(v) { return v.f + " " + v.g + " " + v.m() + " " + (v instanceof F) + " " + (v instanceof G); }
console.log(show(new F())); console.log(show(new G()));
function H() { this.h = 3; }
function I() { this.i = 4; }
I.prototype = H.prototype;
H.prototype.n = function () { return "H.n"; };
function look(v) { return v.h + " " + v.i + " " + v.n() + " " + (v instanceof H) + " " + (v instanceof I); }
console.log(look(new H())); console.log(look(new I()));
