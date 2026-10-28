// Prints where a stack trace places a call or a member access on a value that Bun's transpiler folds from constants at the top of a module, in blocks, classes, generators and closures.
function place(error) {
  return /:(\d+:\d+)\)?$/.exec(String(error.stack).split("\n")[1])[1];
}
const a = "x"; const b = a + "y"; const c = b + "z";
const n = 2; const m = -n; const k = -m; const d = k ? null : 1;
const s = n + 1; const t = s + "u"; const len = a.length;
try { c(); } catch (e) { console.log("t1", place(e)); }
try { d.x; } catch (e) { console.log("t2", place(e)); }
try { b(); } catch (e) { console.log("t3", place(e)); }
try { (a + "y")(); } catch (e) { console.log("t4", place(e)); }
try { t(); } catch (e) { console.log("t5", place(e)); }
try { s(); } catch (e) { console.log("t6", place(e)); }
try { len(); } catch (e) { console.log("t7", place(e)); }
try { (m ? null : 1).x; } catch (e) { console.log("t8", place(e)); }
try { (m && null).x; } catch (e) { console.log("t9", place(e)); }
function inner() { return c(); }
try { inner(); } catch (e) { console.log("t10", place(e)); }
const arrow = () => d.x;
try { arrow(); } catch (e) { console.log("t11", place(e)); }
{ const p = "x"; const q = p + "y"; const r = q + "z"; try { r(); } catch (e) { console.log("t12", place(e)); } }
{ const p = 2; const q = -p; const r = q ? null : 1; try { r.x; } catch (e) { console.log("t13", place(e)); } }
for (const i of [1]) { const p = "x"; const q = p + "y"; try { q(); } catch (e) { console.log("t14", place(e)); } }
if (n) { const p = "x"; const q = p + "y"; try { q(); } catch (e) { console.log("t15", place(e)); } }
class K { static m() { const p = "x"; const q = p + "y"; const r = q + "z"; return r(); } get g() { const p = 2; const q = -p; const r = q ? null : 1; return r.x; } }
try { K.m(); } catch (e) { console.log("t16", place(e)); }
try { new K().g; } catch (e) { console.log("t17", place(e)); }
function* gen() { const p = "x"; const q = p + "y"; yield q(); }
try { gen().next(); } catch (e) { console.log("t18", place(e)); }
async function later() { const p = "x"; const q = p + "y"; const r = q + "z"; return r(); }
await later().catch(e => console.log("t19", place(e)));
function outer() { const p = "x"; const q = p + "y"; return () => q(); }
try { outer()(); } catch (e) { console.log("t20", place(e)); }
function outer2() { const p = "x"; return () => (p + "y")(); }
try { outer2()(); } catch (e) { console.log("t21", place(e)); }
function outer3() { const p = 2; const q = -p; return () => (q ? null : 1).x; }
try { outer3()(); } catch (e) { console.log("t22", place(e)); }
switch (n) { case 2: { const p = "x"; const q = p + "y"; try { q(); } catch (e) { console.log("t23", place(e)); } } }
export const shown = "x"; export const joined = shown + "y";
try { joined(); } catch (e) { console.log("t24", place(e)); }
try { (shown + "y")(); } catch (e) { console.log("t25", place(e)); }
