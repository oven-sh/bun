// What new F() stands below: F.prototype is never stored, stored first, later, in a loop, through an alias, a helper, a descriptor; F is made once or several times.
const out = [];
function attempt(label, body) { try { out.push(label + " " + body()); } catch (error) { out.push(label + " " + error.constructor.name); } }
function show(o, F) { const p = Object.getPrototypeOf(o); return [o.n, o.tag, o.get && o.get(), p === F.prototype, p === Object.prototype, o.constructor === F].join(); }
const kept = [];

function Never(n) { this.n = n; }
Never.prototype.get = function () { return "get" + this.n; };
attempt("never", () => { const t = []; for (let i = 0; i < 4; i++) { const o = new Never(i); kept[i & 1] = o; t.push(show(o, Never)); } return t.join(" "); });
attempt("outside", () => show(new Never(9), Never));
attempt("reflected", () => show(Reflect.construct(Never, [5], function () {}), Never));
attempt("below", () => show(new (class extends Never {})(6), Never));
attempt("spread", () => show(new Never(...[7]), Never));

function Bare() {}
attempt("bare", () => { const t = []; for (let i = 0; i < 4; i++) { const o = new Bare(); kept[i & 1] = o; t.push(show(o, Bare)); } return t.join(" "); });
attempt("bare again", () => { Bare.prototype.tag = "late"; return show(kept[0], Bare); });

function Parent(n) { this.n = n; }
Object.setPrototypeOf(Parent.prototype, { tag: "above" });
attempt("parent", () => { const t = []; for (let i = 0; i < 4; i++) { const o = new Parent(i); kept[i & 1] = o; t.push(show(o, Parent)); } return t.join(" "); });

function replaced(label, F, change, at) {
  attempt(label, () => { const t = []; for (let i = 0; i < 5; i++) { if (i === at) change(F); const o = new F(i); kept[i & 1] = o; t.push(show(o, F)); } return t.join(" "); });
}
const other = tag => ({ tag, get() { return tag + this.n; } });
function A(n) { this.n = n; } replaced("assigned", A, F => { F.prototype = other("a"); }, 3);
function B(n) { this.n = n; } replaced("first", B, F => { F.prototype = other("b"); }, 0);
function C(n) { this.n = n; } replaced("defined", C, F => { Object.defineProperty(F, "prototype", { value: other("c") }); }, 2);
function D(n) { this.n = n; } replaced("copied", D, F => { Object.assign(F, { prototype: other("d") }); }, 2);
function E(n) { this.n = n; } replaced("primitive", E, F => { F.prototype = 5; }, 2);
function G(n) { this.n = n; } replaced("keyed", G, F => { F[["proto", "type"].join("")] = other("g"); }, 2);
function H(n) { this.n = n; } replaced("never at all", H, () => {}, 2);

function make() { return function (n) { this.n = n; }; }
const First = make(), Second = make();
First.prototype.tag = "first"; Second.prototype.tag = "second";
attempt("several", () => { const t = []; for (let i = 0; i < 4; i++) { const o = new (i & 1 ? First : Second)(i); kept[i & 1] = o; t.push(o.tag, o instanceof First); } return t.join(); });

const alias = Later; function Later(n) { this.n = n; }
attempt("before", () => { const t = []; for (let i = 0; i < 3; i++) { const o = new Later(i); kept[i & 1] = o; t.push(show(o, Later)); } return t.join(" "); });
alias.prototype = other("later");
attempt("behind", () => { const t = []; for (let i = 0; i < 3; i++) { const o = new Later(i); kept[i & 1] = o; t.push(show(o, Later)); } return t.join(" "); });
console.log(out.join("\n"));
