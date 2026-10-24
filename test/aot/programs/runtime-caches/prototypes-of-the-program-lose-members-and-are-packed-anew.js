// Prototype objects of the program's own lose members, are churned until their storage is packed anew, and their heirs are read by name.
function hide(value) { return JSON.parse("[0]", function (k, v) { return k === "" ? value : v; }); }
function a(o) { return o.a; } function m(o) { return o.m(); } function g(o) { return o.g; } function z(o) { return o.z; }
function none(o) { return o.nothingHere; }
function put(o, v) { o.s = v; return o.seen; }
function churn(p, tag, n) { for (let i = 0; i < n; i++) { p[tag + i] = i; delete p[tag + i]; } }
function scene(title, proto, heir) {
    const all = () => [a(heir), m(heir), g(heir), z(heir), put(heir, title)].join();
    for (let i = 0; i < 60; i++) { all(); a({}); m({ m() {} }); g({ g: 1 }); z([]); }
    const before = all();
    delete proto.first; delete proto.second;
    churn(proto, "c", 300);
    const churned = all();
    for (let i = 0; i < 40; i++) none(heir);
    console.log(title, before, before === churned, before === all(), before === all());
    Object.freeze(proto);
    console.log(title, "frozen", before === all());
}
function members() { return { first: 1, second: 2, a: "a", m() { return "m"; }, get g() { return "g"; }, set s(v) { this.seen = v; }, z: "z" }; }
{ const p = members(); scene("literal", p, Object.create(p)); }
{ const p = hide(members()); scene("hidden", p, hide(Object.create(p))); }
{ class C { m() { return "m"; } get g() { return "g"; } set s(v) { this.seen = v; } } C.prototype.first = 1; C.prototype.second = 2; C.prototype.a = "a"; C.prototype.z = "z"; scene("class", C.prototype, new C()); }
{ class C { m() { return "m"; } get g() { return "g"; } set s(v) { this.seen = v; } } const P = hide(C.prototype); P.first = 1; P.second = 2; P.a = "a"; P.z = "z"; scene("hidden class", P, hide(new C())); }
{ function F() {} Object.assign(F.prototype, { first: 1, second: 2, a: "a", z: "z", m() { return "m"; } }); Object.defineProperty(F.prototype, "g", { get() { return "g"; }, configurable: true }); Object.defineProperty(F.prototype, "s", { set(v) { this.seen = v; }, configurable: true }); scene("function", F.prototype, new F()); }
{ const top = members(); const mid = Object.create(top); mid.extra = 1; scene("two levels", top, Object.create(mid)); }
{ const p = members(); const arr = hide([1, 2]); Object.setPrototypeOf(arr, Object.setPrototypeOf(p, Array.prototype)); scene("array heir", p, arr); }
{ const p = members(); const f = hide(function () {}); Object.setPrototypeOf(f, Object.setPrototypeOf(p, Function.prototype)); scene("function heir", p, f); }
