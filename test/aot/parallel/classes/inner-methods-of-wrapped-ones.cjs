// STATISTIC: InnerMethodsSpeculated >= 6
// What a method that replaces another one of a constructor function's prototype calls by `inner.call(this)`.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
function hot(C, n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) list.push(new C(i, i + 1)); for (let k = 0; k < n; k++) { const p = list[k & 7]; total = (total + p.step(k).sum(k & 3)) | 0; } return total; }
function step(k) { this.x = (this.x + k) & 1023; return this; }
function A(x, y) { this.x = x; this.y = y; }
A.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
A.prototype.sum = function (k) { return this.x + this.y + k; };
const innerA = A.prototype.sum;
A.prototype.sum = function (k) { return innerA.call(this, k + 1); };
tell("call", () => [new A(1, 2).sum(3), hot(A, 800)]);
function B(x, y) { this.x = x; this.y = y; }
B.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
B.prototype.sum = function (k) { return this.x + this.y + k; };
let calls = 0;
const firstB = B.prototype.sum;
B.prototype.sum = function () { calls++; return firstB.apply(this, arguments); };
const secondB = B.prototype.sum;
B.prototype.sum = function (...rest) { return secondB.apply(this, rest) * 2; };
tell("apply", () => [new B(1, 2).sum(3), hot(B, 800), calls]);
function C(x, y) { this.x = x; this.y = y; }
C.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
C.prototype.sum = function (k) { return this.x + this.y + k; };
(function (inner) { C.prototype.sum = function (k) { return inner.call(this, k) + 20; }; })(C.prototype.sum);
tell("called at once", () => [new C(1, 2).sum(3), hot(C, 800)]);
(() => { const inner = C.prototype.sum; C.prototype.sum = function (k) { return inner.call(this, k) - 5; }; })();
tell("called at once again", () => [new C(1, 2).sum(3), hot(C, 800)]);
function D(x, y) { this.x = x; this.y = y; }
D.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
D.prototype.sum = function (k) { return this.x + this.y + k; };
let innerD = D.prototype.sum;
D.prototype.sum = function (k) { return innerD.call(this, k) + 1; };
tell("variable", () => [new D(1, 2).sum(3), hot(D, 800)]);
innerD = function (k) { return 100 + k; };
tell("changed variable", () => [new D(1, 2).sum(3), hot(D, 800)]);
innerD = null;
tell("no function", () => new D(1, 2).sum(3));
function E(x, y) { this.x = x; this.y = y; }
E.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
E.prototype.sum = function (k) { return this.x + this.y + k; };
if (process.argv.length < 9) { const inner = E.prototype.sum; E.prototype.sum = function (k) { return -inner.call(this, k); }; }
tell("taken branch", () => [new E(1, 2).sum(3), hot(E, 800)]);
function F(x, y) { this.x = x; this.y = y; }
F.prototype.step = A.prototype.step;
F.prototype.sum = A.prototype.sum;
const innerF = F.prototype.sum;
F.prototype.sum = function (k) { return innerF.call(this, k) + 7; };
tell("method of another", () => [new F(1, 2).sum(3), hot(F, 800), hot(A, 100)]);
function Base(x) { this.x = x; }
Base.prototype.step = function (k) { this.x = (this.x + k) & 1023; return this; };
Base.prototype.sum = function (k) { return this.x + k; };
function Heir(x, y) { Base.call(this, x); this.y = y; }
Heir.prototype = Object.create(Base.prototype);
Heir.prototype.constructor = Heir;
const ofBase = Heir.prototype.sum;
Heir.prototype.sum = function (k) { return ofBase.call(this, k) + this.y; };
const ofHeir = Heir.prototype.sum;
Heir.prototype.sum = function (k) { return ofHeir.call(this, k) * 3; };
tell("heir", () => [new Heir(1, 2).sum(3), hot(Heir, 800), hot(Base, 800)]);
function G(x, y) { this.x = x; this.y = y; }
G.prototype.step = step;
G.prototype.sum = function (k) { return this.x + this.y + k; };
function patch() { const inner = G.prototype.sum; G.prototype.sum = function (k) { return inner.call(this, k) + 10; }; }
for (let i = 0; i < 3; i++) { patch(); tell("patched " + i, () => [new G(1, 2).sum(3), hot(G, 100)]); }
for (const line of out) console.log(line);
