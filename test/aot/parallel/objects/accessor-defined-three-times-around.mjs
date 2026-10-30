// Object literals define one accessor three times. Some of the getters and setters read `super`, and the members between them store to what they read.

const log = [];
const base = { get z() { return "base"; }, set z(x) { log.push("base set " + x); } };
const more = { p: "from more", u: 1 };
const key = "p";
function show(label, o) {
  const parts = [];
  for (const k of Reflect.ownKeys(o).sort()) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if ("value" in d) parts.push(k + "=" + (typeof d.value === "function" ? "f:" + (d.value.prototype === undefined ? d.value() : "class") : JSON.stringify(d.value)));
    else parts.push(k + "<" + (d.get ? d.get.name + ":" + d.get.call(o) : "-") + "|" + (d.set ? d.set.name : "-") + ">");
  }
  console.log(label, parts.join(" "));
}
function make725(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { c = x; }, get p() { return 'G1 ' + c + ' ' + super.z; }, get [(c = 45, 'p')]() { return 'computed ' + c; }, get p() { return (() => 'A2 ' + c + ' ' + super.z)(); }, set other(x) { c = x; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make725(v); show("725", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("725 again", o); }
console.log(log.splice(0).join("|"));
function make728(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { c = x; }, get p() { return 'G1 ' + c + ' ' + super.z; }, get p() { return (() => 'A2 ' + c + ' ' + super.z)(); }, set other(x) { c = x; }, ...more };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make728(v); show("728", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("728 again", o); }
console.log(log.splice(0).join("|"));
function make730(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { c = x; }, get p() { return 'G1 ' + c + ' ' + super.z; }, q51: 51, get p() { return (() => 'A2 ' + c + ' ' + super.z)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make730(v); show("730", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("730 again", o); }
console.log(log.splice(0).join("|"));
function make734(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...more, get p() { return 'k0 ' + K; }, m53() { return super.z + c; }, set p(x) { log.push('s1 ' + x + ' ' + c); }, get r() { return 'G7 ' + c + ' ' + super.z; }, p: (c = 54), set r(x) { super.z = 'S8 ' + x + ' ' + c; }, get p() { return (() => 'a2 ' + c)(); }, ...(c = 55, { e55: c }) };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make734(v); show("734", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("734 again", o); }
console.log(log.splice(0).join("|"));
function make737(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'k0 ' + K; }, q57: (c = v + 57), q58: (d = c, c = v * 58), set p(x) { log.push('s1 ' + x + ' ' + c); }, get p() { return (() => 'a2 ' + c)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make737(v); show("737", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("737 again", o); }
console.log(log.splice(0).join("|"));
function make741(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'k0 ' + K; }, q60: 60, set p(x) { log.push('s1 ' + x + ' ' + c); }, q61: () => c, get p() { return (() => 'a2 ' + c)(); }, ...more };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make741(v); show("741", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("741 again", o); }
console.log(log.splice(0).join("|"));
function make743(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, q64: (c = v + 64), get p() { return 'd1 ' + c + ' ' + d; }, get p() { return 'k2 ' + K; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make743(v); show("743", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("743 again", o); }
console.log(log.splice(0).join("|"));
function make746(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, ['q' + 66]: (c = 66), get p() { return 'd1 ' + c + ' ' + d; }, ...(c = 67, { e67: c }), get p() { return 'k2 ' + K; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make746(v); show("746", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("746 again", o); }
console.log(log.splice(0).join("|"));
function make750(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, q69: (d = c, c = v * 69), get p() { return 'd1 ' + c + ' ' + d; }, __proto__: (c = 70, base), get p() { return 'k2 ' + K; }, get [(c = 71, 'p')]() { return 'computed ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make750(v); show("750", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("750 again", o); }
console.log(log.splice(0).join("|"));
function make753(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...(c = 3, {}), get p() { return 'g0 ' + c; }, q73: (c = v + 73), get p() { return 'G1 ' + c + ' ' + super.z; }, q74: 74, set p(x) { super.z = 'S2 ' + x + ' ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make753(v); show("753", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("753 again", o); }
console.log(log.splice(0).join("|"));
function make757(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get r() { return (() => 'a7 ' + c)(); }, get p() { return 'g0 ' + c; }, set r(x) { super.z = 'S8 ' + x + ' ' + c; }, q76: c++, get p() { return 'G1 ' + c + ' ' + super.z; }, ['q' + 77]: (c = 77), set other(x) { c = x; }, set p(x) { super.z = 'S2 ' + x + ' ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make757(v); show("757", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("757 again", o); }
console.log(log.splice(0).join("|"));
function make762(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get r() { return 'd7 ' + c + ' ' + d; }, get p() { return 'g0 ' + c; }, q80: (c = v + 80), get p() { return 'G1 ' + c + ' ' + super.z; }, get other() { return c; }, ...(c = 82, { e82: c }), set p(x) { super.z = 'S2 ' + x + ' ' + c; }, set r(x) { log.push('t8 ' + x + ' ' + d); }, q83: 83 };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make762(v); show("762", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("762 again", o); }
console.log(log.splice(0).join("|"));
function make764(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { first: 1, get p() { return 'k0 ' + K; }, get r() { return (() => 'A7 ' + c + ' ' + super.z)(); }, get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, set r(x) { log.push('s8 ' + x + ' ' + c); }, q85: class { static x = (c = 85); }, get p() { return 'k2 ' + K; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make764(v); show("764", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("764 again", o); }
console.log(log.splice(0).join("|"));
function make767(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'k0 ' + K; }, q87: bump(87), get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, [(c = 88, 'k88')]: c, get p() { return 'k2 ' + K; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make767(v); show("767", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("767 again", o); }
console.log(log.splice(0).join("|"));
function make773(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get r() { return 'k7 ' + K; }, get p() { return 'k0 ' + K; }, ...(c = 90, { e90: c }), q91: () => c, get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, q92: { get p() { return c; }, w: (c = 92), set p(x) {} }, q93: [c, (c = 93)], set r(x) { log.push('s8 ' + x + ' ' + c); }, get p() { return 'k2 ' + K; }, p: (c = 94) };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make773(v); show("773", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("773 again", o); }
console.log(log.splice(0).join("|"));
function make775(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, set p(x) { super.z = 'S1 ' + x + ' ' + c; }, q96: c++, get p() { return 'g2 ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make775(v); show("775", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("775 again", o); }
console.log(log.splice(0).join("|"));
function make779(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, set p(x) { super.z = 'S1 ' + x + ' ' + c; }, q1: (d = c, c = v * 1), get p() { return 'g2 ' + c; }, q2: (d = c, c = v * 2), q3: 3 };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make779(v); show("779", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("779 again", o); }
console.log(log.splice(0).join("|"));
function make783(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...more, get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, [(c = 5, 'k5')]: c, q6: bump(6), set p(x) { super.z = 'S1 ' + x + ' ' + c; }, q7: c++, get r() { return 'g7 ' + c; }, set r(x) { log.push('s8 ' + x + ' ' + c); }, get p() { return 'g2 ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make783(v); show("783", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("783 again", o); }
console.log(log.splice(0).join("|"));
function make787(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, set other(x) { c = x; }, q10: (d = c, c = v * 10), set p(x) { c = x; }, ...more, set p(x) { c = x; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make787(v); show("787", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("787 again", o); }
console.log(log.splice(0).join("|"));
function make789(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, q13: bump(13), set p(x) { c = x; }, set p(x) { c = x; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make789(v); show("789", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("789 again", o); }
console.log(log.splice(0).join("|"));
function make792(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, q15: bump(15), q16: { get p() { return c; }, w: (c = 16), set p(x) {} }, set p(x) { c = x; }, get r() { return 'g7 ' + c; }, set p(x) { c = x; }, set r(x) { log.push('t8 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make792(v); show("792", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("792 again", o); }
console.log(log.splice(0).join("|"));
function make794(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, [(c = 18, 'k18')]: c, get p() { return 'g1 ' + c; }, set p(x) { log.push('t2 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make794(v); show("794", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("794 again", o); }
console.log(log.splice(0).join("|"));
function make797(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, ['p']: (c = 20), get p() { return 'g1 ' + c; }, q21: c++, set p(x) { log.push('t2 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make797(v); show("797", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("797 again", o); }
console.log(log.splice(0).join("|"));
function make802(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, get [(c = 23, 'p')]() { return 'computed ' + c; }, get p() { return 'g1 ' + c; }, ...more, ['q' + 25]: (c = 25), set p(x) { log.push('t2 ' + x + ' ' + d); }, get [(c = 26, 'p')]() { return 'computed ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make802(v); show("802", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("802 again", o); }
console.log(log.splice(0).join("|"));
function make805(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'g0 ' + c; }, get [(c = 28, 'p')]() { return 'computed ' + c; }, set p(x) { log.push('t1 ' + x + ' ' + d); }, q29: [c, (c = 29)], set p(x) { log.push('t2 ' + x + ' ' + d); }, get r() { return 'k7 ' + K; }, set r(x) { c = x; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make805(v); show("805", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("805 again", o); }
console.log(log.splice(0).join("|"));
function make808(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'g0 ' + c; }, m31() { return super.z + c; }, get r() { return 'G7 ' + c + ' ' + super.z; }, set p(x) { log.push('t1 ' + x + ' ' + d); }, q32: (c = v + 32), set r(x) { log.push('s8 ' + x + ' ' + c); }, set p(x) { log.push('t2 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make808(v); show("808", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("808 again", o); }
console.log(log.splice(0).join("|"));
function make811(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'g0 ' + c; }, get [(c = 34, 'p')]() { return 'computed ' + c; }, set p(x) { log.push('t1 ' + x + ' ' + d); }, __proto__: (c = 35, base), set p(x) { log.push('t2 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make811(v); show("811", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("811 again", o); }
console.log(log.splice(0).join("|"));
function make814(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, q37: [c, (c = 37)], get p() { return 'g1 ' + c; }, q38: class { static x = (c = 38); }, get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make814(v); show("814", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("814 again", o); }
console.log(log.splice(0).join("|"));
function make819(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, q40: (d = c, c = v * 40), q41: bump(41), get p() { return 'g1 ' + c; }, get [(c = 42, 'p')]() { return 'computed ' + c; }, __proto__: (c = 43, base), get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make819(v); show("819", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("819 again", o); }
console.log(log.splice(0).join("|"));
function make824(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, ...(c = 45, { e45: c }), get other() { return c; }, get p() { return 'g1 ' + c; }, q47: [c, (c = 47)], q48: (c = v + 48), get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make824(v); show("824", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("824 again", o); }
console.log(log.splice(0).join("|"));
function make828(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, [(c = 50, 'k50')]: c, get p() { return 'd1 ' + c + ' ' + d; }, p: (c = 51), q52: 52, get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make828(v); show("828", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("828 again", o); }
console.log(log.splice(0).join("|"));
function make831(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, get [(c = 54, 'p')]() { return 'computed ' + c; }, get p() { return 'd1 ' + c + ' ' + d; }, __proto__: (c = 55, base), get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make831(v); show("831", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("831 again", o); }
console.log(log.splice(0).join("|"));
function make834(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get r() { return 'k7 ' + K; }, get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, q57: bump(57), set r(x) { log.push('t8 ' + x + ' ' + d); }, ['p']: (c = 58), get p() { return 'd1 ' + c + ' ' + d; }, get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make834(v); show("834", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("834 again", o); }
console.log(log.splice(0).join("|"));
function make837(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { first: 1, get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, q60: (d = c, c = v * 60), q61: (d = c, c = v * 61), get p() { return 'd2 ' + c + ' ' + d; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make837(v); show("837", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("837 again", o); }
console.log(log.splice(0).join("|"));
function make840(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, get other() { return c; }, get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, [(c = 64, 'k64')]: c, get p() { return 'd2 ' + c + ' ' + d; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make840(v); show("840", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("840 again", o); }
console.log(log.splice(0).join("|"));
function make845(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, m66() { return c; }, [key]: (c = 67), get r() { return (() => 'A7 ' + c + ' ' + super.z)(); }, get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, m68() { return c; }, __proto__: (c = 69, base), get p() { return 'd2 ' + c + ' ' + d; }, set r(x) { c = x; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make845(v); show("845", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("845 again", o); }
console.log(log.splice(0).join("|"));
function make849(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, get [(c = 71, 'p')]() { return 'computed ' + c; }, get p() { return 'G1 ' + c + ' ' + super.z; }, [key]: (c = 72), q73: c++, get p() { return (() => 'A2 ' + c + ' ' + super.z)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make849(v); show("849", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("849 again", o); }
console.log(log.splice(0).join("|"));
function make853(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...(c = 3, {}), set p(x) { log.push('s0 ' + x + ' ' + c); }, p() { return c; }, get p() { return 'G1 ' + c + ' ' + super.z; }, q76: class { static x = (c = 76); }, [key]: (c = 77), get p() { return (() => 'A2 ' + c + ' ' + super.z)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make853(v); show("853", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("853 again", o); }
console.log(log.splice(0).join("|"));
function make857(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...(c = 3, {}), set p(x) { log.push('s0 ' + x + ' ' + c); }, [key]: (c = 79), q80: class { static x = (c = 80); }, get p() { return 'G1 ' + c + ' ' + super.z; }, get p() { return (() => 'A2 ' + c + ' ' + super.z)(); }, p: (c = 81) };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make857(v); show("857", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("857 again", o); }
console.log(log.splice(0).join("|"));
function make860(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, get other() { return c; }, ...(c = 84, { e84: c }), get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, get p() { return (() => 'a2 ' + c)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make860(v); show("860", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("860 again", o); }
console.log(log.splice(0).join("|"));
function make861(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { first: 1, get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, get p() { return (() => 'a2 ' + c)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make861(v); show("861", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("861 again", o); }
console.log(log.splice(0).join("|"));
function make864(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...(c = 3, {}), get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, ...(c = 87, { e87: c }), get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, q88: bump(88), get p() { return (() => 'a2 ' + c)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make864(v); show("864", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("864 again", o); }
console.log(log.splice(0).join("|"));
function make868(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, __proto__: (c = 90, base), get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, q91: 91, ...(c = 92, { e92: c }), set p(x) { super.z = 'S2 ' + x + ' ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make868(v); show("868", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("868 again", o); }
console.log(log.splice(0).join("|"));
function make873(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, ...more, get r() { return (() => 'A7 ' + c + ' ' + super.z)(); }, get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, ...(c = 95, { e95: c }), set p(x) { super.z = 'S2 ' + x + ' ' + c; }, m96() { return c; }, ['p']: (c = 97), set r(x) { log.push('s8 ' + x + ' ' + c); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make873(v); show("873", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("873 again", o); }
console.log(log.splice(0).join("|"));
function make877(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...(c = 3, {}), set p(x) { log.push('s0 ' + x + ' ' + c); }, [(c = 2, 'k2')]: c, set other(x) { c = x; }, get p() { return (() => 'A1 ' + c + ' ' + super.z)(); }, m4() { return super.z + c; }, set p(x) { super.z = 'S2 ' + x + ' ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make877(v); show("877", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("877 again", o); }
console.log(log.splice(0).join("|"));
function make883(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('s0 ' + x + ' ' + c); }, q6: [c, (c = 6)], set p(x) { c = x; }, q7: [c, (c = 7)], q8: class { static x = (c = 8); }, get p() { return 'g2 ' + c; }, m9() { return super.z + c; }, q10: (d = c, c = v * 10) };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make883(v); show("883", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("883 again", o); }
console.log(log.splice(0).join("|"));
function make886(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...more, set p(x) { log.push('s0 ' + x + ' ' + c); }, ['p']: (c = 12), get r() { return 'd7 ' + c + ' ' + d; }, set p(x) { c = x; }, set r(x) { log.push('s8 ' + x + ' ' + c); }, set other(x) { c = x; }, get p() { return 'g2 ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make886(v); show("886", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("886 again", o); }
console.log(log.splice(0).join("|"));
function make890(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...more, set p(x) { log.push('s0 ' + x + ' ' + c); }, get other() { return c; }, __proto__: (c = 16, base), set p(x) { c = x; }, q17: (d = c, c = v * 17), get p() { return 'g2 ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make890(v); show("890", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("890 again", o); }
console.log(log.splice(0).join("|"));
function make893(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, [(c = 19, 'k19')]: c, set p(x) { log.push('s1 ' + x + ' ' + c); }, q20: (c = v + 20), set p(x) { super.z = 'S2 ' + x + ' ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make893(v); show("893", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("893 again", o); }
console.log(log.splice(0).join("|"));
function make898(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...more, get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, ['p']: (c = 22), p() { return c; }, set p(x) { log.push('s1 ' + x + ' ' + c); }, ['p']: (c = 24), set p(x) { super.z = 'S2 ' + x + ' ' + c; }, ...more };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make898(v); show("898", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("898 again", o); }
console.log(log.splice(0).join("|"));
function make902(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, q27: (c = v + 27), p: (c = 28), set p(x) { log.push('s1 ' + x + ' ' + c); }, m29() { return super.z + c; }, set p(x) { super.z = 'S2 ' + x + ' ' + c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make902(v); show("902", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("902 again", o); }
console.log(log.splice(0).join("|"));
function make905(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('t0 ' + x + ' ' + d); }, m31() { return super.z + c; }, get r() { return (() => 'a7 ' + c)(); }, set p(x) { log.push('s1 ' + x + ' ' + c); }, set r(x) { super.z = 'S8 ' + x + ' ' + c; }, get [(c = 32, 'p')]() { return 'computed ' + c; }, get p() { return 'd2 ' + c + ' ' + d; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make905(v); show("905", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("905 again", o); }
console.log(log.splice(0).join("|"));
function make907(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('t0 ' + x + ' ' + d); }, q34: (d = c, c = v * 34), set p(x) { log.push('s1 ' + x + ' ' + c); }, get p() { return 'd2 ' + c + ' ' + d; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make907(v); show("907", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("907 again", o); }
console.log(log.splice(0).join("|"));
function make910(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('t0 ' + x + ' ' + d); }, q36: c++, set p(x) { log.push('s1 ' + x + ' ' + c); }, q37: 37, get p() { return 'd2 ' + c + ' ' + d; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make910(v); show("910", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("910 again", o); }
console.log(log.splice(0).join("|"));
function make913(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'a0 ' + c)(); }, get [(c = 39, 'p')]() { return 'computed ' + c; }, get p() { return 'g1 ' + c; }, q40: bump(40), get p() { return (() => 'A2 ' + c + ' ' + super.z)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make913(v); show("913", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("913 again", o); }
console.log(log.splice(0).join("|"));
function make917(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'a0 ' + c)(); }, [key]: (c = 42), get p() { return 'g1 ' + c; }, [key]: (c = 43), q44: (c = v + 44), get p() { return (() => 'A2 ' + c + ' ' + super.z)(); }, get r() { return 'k7 ' + K; }, set r(x) { log.push('t8 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make917(v); show("917", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("917 again", o); }
console.log(log.splice(0).join("|"));
function make919(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get r() { return 'k7 ' + K; }, get p() { return (() => 'a0 ' + c)(); }, set r(x) { c = x; }, q46: bump(46), get p() { return 'g1 ' + c; }, get p() { return (() => 'A2 ' + c + ' ' + super.z)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make919(v); show("919", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("919 again", o); }
console.log(log.splice(0).join("|"));
function make923(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...more, get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, ['p']: (c = 48), q49: c++, get p() { return 'g1 ' + c; }, q50: { get p() { return c; }, w: (c = 50), set p(x) {} }, get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make923(v); show("923", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("923 again", o); }
console.log(log.splice(0).join("|"));
function make925(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { ...more, get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, get p() { return 'g1 ' + c; }, __proto__: (c = 52, base), get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make925(v); show("925", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("925 again", o); }
console.log(log.splice(0).join("|"));
function make927(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return (() => 'A0 ' + c + ' ' + super.z)(); }, get p() { return 'g1 ' + c; }, get other() { return c; }, get p() { return 'G2 ' + c + ' ' + super.z; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make927(v); show("927", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("927 again", o); }
console.log(log.splice(0).join("|"));
function make931(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'g0 ' + c; }, q56: class { static x = (c = 56); }, set other(x) { c = x; }, get p() { return 'G1 ' + c + ' ' + super.z; }, [(c = 58, 'k58')]: c, get p() { return (() => 'a2 ' + c)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make931(v); show("931", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("931 again", o); }
console.log(log.splice(0).join("|"));
function make935(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'g0 ' + c; }, q60: [c, (c = 60)], ...more, get p() { return 'G1 ' + c + ' ' + super.z; }, q62: class { static x = (c = 62); }, get p() { return (() => 'a2 ' + c)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make935(v); show("935", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("935 again", o); }
console.log(log.splice(0).join("|"));
function make940(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { first: 1, get p() { return 'g0 ' + c; }, q64: 64, m65() { return c; }, get p() { return 'G1 ' + c + ' ' + super.z; }, ...more, q67: () => c, get p() { return (() => 'a2 ' + c)(); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make940(v); show("940", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("940 again", o); }
console.log(log.splice(0).join("|"));
function make944(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'd0 ' + c + ' ' + d; }, ...(c = 69, { e69: c }), set p(x) { super.z = 'S1 ' + x + ' ' + c; }, set p(x) { log.push('s2 ' + x + ' ' + c); }, p: (c = 70), q71: c++ };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make944(v); show("944", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("944 again", o); }
console.log(log.splice(0).join("|"));
function make948(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get r() { return 'g7 ' + c; }, set r(x) { log.push('t8 ' + x + ' ' + d); }, get p() { return 'd0 ' + c + ' ' + d; }, set p(x) { super.z = 'S1 ' + x + ' ' + c; }, q73: class { static x = (c = 73); }, q74: { get p() { return c; }, w: (c = 74), set p(x) {} }, set p(x) { log.push('s2 ' + x + ' ' + c); }, q75: () => c };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make948(v); show("948", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("948 again", o); }
console.log(log.splice(0).join("|"));
function make951(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'd0 ' + c + ' ' + d; }, ['p']: (c = 77), set p(x) { super.z = 'S1 ' + x + ' ' + c; }, ['q' + 78]: (c = 78), set p(x) { log.push('s2 ' + x + ' ' + c); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make951(v); show("951", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("951 again", o); }
console.log(log.splice(0).join("|"));
function make953(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get r() { return 'G7 ' + c + ' ' + super.z; }, ...(c = 3, {}), set p(x) { log.push('t0 ' + x + ' ' + d); }, set p(x) { log.push('s1 ' + x + ' ' + c); }, ['p']: (c = 80), set p(x) { c = x; }, set r(x) { c = x; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make953(v); show("953", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("953 again", o); }
console.log(log.splice(0).join("|"));
function make955(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('t0 ' + x + ' ' + d); }, set p(x) { log.push('s1 ' + x + ' ' + c); }, get [(c = 82, 'p')]() { return 'computed ' + c; }, set p(x) { c = x; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make955(v); show("955", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("955 again", o); }
console.log(log.splice(0).join("|"));
function make959(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { set p(x) { log.push('t0 ' + x + ' ' + d); }, [key]: (c = 84), set p(x) { log.push('s1 ' + x + ' ' + c); }, m85() { return super.z + c; }, set p(x) { c = x; }, p() { return c; } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make959(v); show("959", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("959 again", o); }
console.log(log.splice(0).join("|"));
function make963(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { first: 1, get p() { return 'g0 ' + c; }, get other() { return c; }, q89: bump(89), set p(x) { log.push('s1 ' + x + ' ' + c); }, q90: class { static x = (c = 90); }, set p(x) { log.push('t2 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make963(v); show("963", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("963 again", o); }
console.log(log.splice(0).join("|"));
function make965(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'g0 ' + c; }, __proto__: (c = 92, base), set p(x) { log.push('s1 ' + x + ' ' + c); }, set p(x) { log.push('t2 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make965(v); show("965", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("965 again", o); }
console.log(log.splice(0).join("|"));
function make968(v) {
  const K = "K" + v;
  let c = 0, d = -1;
  function bump(n) { c += n; return c; }
  const o = { get p() { return 'g0 ' + c; }, q94: () => c, set p(x) { log.push('s1 ' + x + ' ' + c); }, m95() { return c; }, set p(x) { log.push('t2 ' + x + ' ' + d); } };
  Object.getPrototypeOf(o) === Object.prototype && Object.setPrototypeOf(o, base);
  c += 100;
  return o;
}
for (const v of [5, 9]) { const o = make968(v); show("968", o); try { o.p = "x"; } catch (e) { console.log(e.message); } show("968 again", o); }
console.log(log.splice(0).join("|"));
