// Under: --aot-check=Validate: the first read of a member feeds each copy of a loop on the way in and is read by nothing behind that; a hint in a running copy clears its slot, and the head of the closed copy, laid by positions, still lists it: the checker of the allocation stopped the build.
const notes = [];
let more = 0;
function note(s) {
  if (notes.length < 16)
    notes.push(s);
  else
    more++;
}
function fl() {
  const s = notes.length ? " ~" + notes.join(",") + (more ? "+" + String(more) : "") : "";
  notes.length = 0;
  more = 0;
  return s;
}
const G = JSON.parse("[0,1,0,1]");
function vo(t, r) {
  return { valueOf() {
    note(t + ".v");
    return r;
  } };
}

class Ps {
  t;
  r;
  constructor(t, r) {
    this.t = t;
    this.r = r;
  }
  toString() {
    note(this.t + ".s");
    return this.r;
  }
}
const TA = [10, 11, 12], TT = "abc", g10a = new Map([[0, new String("ab")], [1, both("a1", "1", 1n)], [2, new Ps("a2", null)]]);
function f10(ai, b) {
  let r0;
  for (let i = 0;i < G[0]; i++) {
    note("t");
    r0 = Number(g10a.get(ai) && b) !== 2 ** 31;
  }
  return Object.is(r0, -0);
}
function go10(ai, b) {
  let r;
  try {
    r = pSh(f10(ai, b));
  } catch (e) {
    r = "threw " + pName(e);
  }
  return r;
}
function f14(aw) {
  if (aw.v !== aw.v)
    return "out";
  let t = aw.v, r0;
  for (let i = 0;i < G[0]; i++) {
    note("t");
    r0 = t ||= null;
  }
  return TA[r0];
}
function go14(a) {
  let r;
  try {
    r = pShow(f14(a));
  } catch (e) {
    r = "threw " + pName(e);
  }
  return r;
}
{
  let h = 0;
  for (let i = 0;i < 1; i++)
    h = Math.imul(h, 31) + pSum(go10(1, 2)) | 0;
  fl();
  $told("k10heat", " " + String(h), !1);
}
$told("k14r", " " + go14({ w: 0, v: vo("a1", "1.5") }) + fl() + "|" + go14({ v: ts("a0", "2") }) + fl() + "|" + go14({ w: 0, v: vo("a1", "1.5") }) + fl(), !1);
function both(t, s, v) { return { toString() { note(t + ".s"); return s; }, valueOf() { note(t + ".v"); return v; } }; }
function ts(t, r) { return { toString() { note(t + ".s"); return r; } }; }
function pSh(x) { return String(x); }
function pShow(x) { return typeof x + ":" + String(x); }
function pName(e) { return e && e.name; }
function pSum(s) { let h = 0; for (const c of String(s)) h = Math.imul(h, 31) + c.charCodeAt(0) | 0; return h; }
function $told(l, s) { console.log(l + s); }
