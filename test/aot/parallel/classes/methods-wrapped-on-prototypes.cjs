// STATISTIC: RewrittenMethodsSpeculated >= 4
// A method that a constructor function's prototype is given again: `const inner = F.prototype.m; F.prototype.m = function () { return inner.call(this); };`
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name + e.message; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
function A(x, y) { this.x = x; this.y = y; }
A.prototype.sum = function () { return this.x + this.y; };
A.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
tell("before", () => new A(1, 2).sum());
const inner = A.prototype.sum;
A.prototype.sum = function () { return inner.call(this) + 1; };
function hot(C, n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) list.push(new C(i, i + 1)); for (let k = 0; k < n; k++) { const p = list[k & 7]; total = (total + p.step(k).sum()) | 0; } return total; }
tell("after", () => [new A(1, 2).sum(), hot(A, 1000), inner.call(new A(3, 4))]);
function B(x, y) { this.x = x; this.y = y; }
B.prototype.sum = function () { return this.x + this.y; };
B.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
const first = B.prototype.sum;
B.prototype.sum = function () { return first.apply(this, arguments) * 2; };
const second = B.prototype.sum;
B.prototype.sum = function (...rest) { return second.apply(this, rest) + 3; };
tell("twice", () => [new B(1, 2).sum(), hot(B, 1000)]);
B.prototype.sum = first;
tell("restored", () => [new B(1, 2).sum(), hot(B, 1000), B.prototype.sum === first]);
function C(x, y) { this.x = x; this.y = y; }
C.prototype.sum = function () { return this.x + this.y; };
C.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
if (process.argv.length > 9) { const plain = C.prototype.sum; C.prototype.sum = function () { return -plain.call(this); }; }
tell("perhaps", () => [new C(1, 2).sum(), hot(C, 1000)]);
function D(x, y) { this.x = x; this.y = y; }
D.prototype.sum = function () { return this.x + this.y; };
D.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
function install() { const plain = D.prototype.sum; D.prototype.sum = function () { return plain.call(this) + 10; }; }
tell("not installed", () => [new D(1, 2).sum(), hot(D, 100)]);
install();
tell("installed", () => [new D(1, 2).sum(), hot(D, 100)]);
install();
tell("installed again", () => [new D(1, 2).sum(), hot(D, 100)]);
function E(x, y) { this.x = x; this.y = y; }
E.prototype.sum = function () { return this.x + this.y; };
E.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
(function (plain) { E.prototype.sum = function () { return plain.call(this) + 20; }; })(E.prototype.sum);
tell("called at once", () => [new E(1, 2).sum(), hot(E, 100)]);
function Base(x) { this.x = x; }
Base.prototype.sum = function () { return this.x; };
Base.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
function Heir(x, y) { Base.call(this, x); this.y = y; }
Heir.prototype = Object.create(Base.prototype);
Heir.prototype.constructor = Heir;
Heir.prototype.sum = function () { return Base.prototype.sum.call(this) + this.y; };
tell("heir", () => [new Heir(1, 2).sum(), hot(Heir, 500), hot(Base, 500)]);
const ofBase = Base.prototype.sum;
Base.prototype.sum = function () { return ofBase.call(this) * 10; };
tell("heir of a wrapped one", () => [new Heir(1, 2).sum(), hot(Heir, 500), hot(Base, 500)]);
const ofHeir = Heir.prototype.sum;
Heir.prototype.sum = function () { return ofHeir.call(this) + 5; };
tell("wrapped heir", () => [new Heir(1, 2).sum(), hot(Heir, 500)]);
const own = new Heir(5, 6);
own.sum = function () { return "own"; };
tell("own", () => [own.sum(), new Heir(5, 6).sum()]);
delete Heir.prototype.sum;
tell("deleted", () => [new Heir(1, 2).sum(), hot(Heir, 50)]);
Heir.prototype.sum = ofHeir;
tell("put back", () => [new Heir(1, 2).sum(), hot(Heir, 50)]);
function G(x) { this.x = x; }
G.prototype.sum = function () { return this.x; };
G.prototype.sum = 7;
G.prototype.step = function () { return this; };
tell("no function", () => [new G(1).sum, (() => { try { return new G(1).sum(); } catch (e) { return e.constructor.name; } })()]);
for (const line of out) console.log(line);
