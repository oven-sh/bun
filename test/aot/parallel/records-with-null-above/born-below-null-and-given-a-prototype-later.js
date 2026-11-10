"use strict";
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
const hide = (v) => [v][JSON.parse("0")];
const log = [];
function above(tag) {
  return { late: tag + " late", missing: tag + " missing", get got() { log.push(tag + " get"); return tag + " got"; }, set put(v) { log.push(tag + " set " + v); }, set late2(v) { log.push(tag + " set late2 " + v); } };
}

const top = Object.create(null);
top.own = 1;
if (hide(false)) { top.late = "own late"; top.late2 = "own late2"; top.put = "own put"; }
function readsOfTop(n) { let text = ""; for (let i = 0; i < n; i++) text = [top.own, top.late, top.missing, top.got, "late" in top, "missing" in top, "own" in top].join(); return text; }
function storesIntoTop(v) { top.put = v; top.late2 = v; return [Object.hasOwn(top, "put"), Object.hasOwn(top, "late2")].join(); }
console.log("top before", readsOfTop(50));
Object.setPrototypeOf(top, above("top"));
console.log("top behind", readsOfTop(50), storesIntoTop(7), log.splice(0).slice(-3).join("+"));
Object.setPrototypeOf(top, null);
console.log("top cut off", readsOfTop(50), storesIntoTop(8), log.splice(0).join("+"));

function literal(i) { const r = { __proto__: null, own: i }; if (hide(false)) { r.late = "own late"; r.put = 0; } return r; }
function reads(r, n) { let text = ""; for (let i = 0; i < n; i++) text = [r.own, r.late, r.missing, r.got, "late" in r, "missing" in r].join(); return text; }
function stores(r, v) { r.put = v; return Object.hasOwn(r, "put"); }
const stays = literal(1), given = literal(2), byReflect = literal(3), byHidden = literal(4), throughHidden = literal(5);
console.log("before", reads(stays, 20), "|", reads(given, 20));
Object.setPrototypeOf(given, above("given"));
Reflect.setPrototypeOf(byReflect, above("reflect"));
hide(Object.setPrototypeOf)(byHidden, above("hidden"));
Object.setPrototypeOf(hide(throughHidden), above("through"));
for (const r of [stays, given, byReflect, byHidden, throughHidden]) console.log("behind", reads(r, 20), stores(r, 9), log.splice(0).slice(-2).join("+"));

const locked = { __proto__: null, own: 1 };
if (hide(false)) locked.fixed = 0;
function storeFixed(v) { locked.fixed = v; return locked.fixed; }
console.log("fixed before", storeFixed(1), delete locked.fixed);
Object.setPrototypeOf(locked, Object.freeze({ fixed: "above" }));
console.log("fixed behind", attempt(() => storeFixed(2)), locked.fixed, Object.hasOwn(locked, "fixed"));

const chain = { __proto__: null, own: 1 };
function far() { return [chain.deep, "deep" in chain, chain.toString === undefined].join(); }
console.log("chain before", far());
Object.setPrototypeOf(chain, Object.create({ deep: "two above" }));
console.log("chain behind", far());
Object.setPrototypeOf(chain, Object.prototype);
console.log("chain below Object.prototype", far(), typeof chain.hasOwnProperty);

const once = { own: 1 };
if (hide(false)) once.late = 0;
function ofOnce() { return [once.late, once.missing, "late" in once, typeof once.toString].join(); }
console.log("plain", ofOnce());
Object.setPrototypeOf(once, null);
console.log("plain cut off", ofOnce());
Object.setPrototypeOf(once, above("once"));
console.log("plain given", ofOnce());

function Point(x) { this.x = x; if (hide(false)) { this.late = 0; this.put = 0; } }
function ofPoint(o, n) { let text = ""; for (let i = 0; i < n; i++) text = [o.x, o.late, o.missing, "late" in o, typeof o.toString].join(); return text; }
function intoPoint(o, v) { o.put = v; return Object.hasOwn(o, "put"); }
const first = new Point(1);
console.log("made before", ofPoint(first, 20), intoPoint(first, 1));
Point.prototype = above("point");
const second = new Point(2);
console.log("made behind", ofPoint(first, 20), "|", ofPoint(second, 20), intoPoint(second, 2), log.splice(0).join("+"));
Point.prototype = null;
const third = new Point(3);
console.log("made below what is no object", ofPoint(third, 20), intoPoint(third, 3));
function Bare(x) { this.x = x; if (hide(false)) this.late = 0; }
Bare.prototype = Object.create(null);
const bare = new Bare(1);
function ofBare(o) { return [o.x, o.late, o.missing, "late" in o, typeof o.toString].join(); }
console.log("bare before", ofBare(bare));
Bare.prototype.late = "laid on the prototype";
Bare.prototype.missing = "laid too";
console.log("bare behind", ofBare(bare), ofBare(new Bare(2)));
