// Each level of a deep recursion tries once on its way back up, so some tries run out of stack between two stores.
const log = (...a) => console.log(a.map(String).join(" "));
// Every level on the way back up tries once; the first tries run out of stack somewhere inside.
function atEveryDepth(attempt) { let failures = 0; function dive(n) { try { dive(n + 1); } catch (e) { } try { attempt(); } catch (e) { if (e instanceof RangeError) failures++; else throw e; } } try { dive(0); } catch (e) { } return failures > 0; }
function rec(n) { return n === 0 ? 0 : rec(n - 1) + 1; } function h1(x) { return rec(60) + x; }
// 1: a variable that is stored behind a call
let v1; let seen1 = new Set(); function init1() { h1(1); v1 = { n: 1 }; } function use1() { return v1 === undefined ? "undefined" : v1.n; }
log(1, atEveryDepth(() => { if (v1 === undefined) { try { init1(); } finally { seen1.add(use1()); } } }), [...seen1].sort().join());
// 2: two variables that change together
let a2 = 0, b2 = 0, torn2 = false; function step2() { a2++; h1(1); b2++; } atEveryDepth(() => { try { step2(); } finally { if (a2 !== b2) torn2 = true; } }); log(2, torn2, a2 > b2);
// 3: an object kept by the caller of a constructor through a parameter
const kept3 = []; class C3 { constructor(sink) { this.a = 1; sink.push(this); this.b = h1(1); this.c = { n: 3 }; } read() { return this.c === undefined ? "none" : this.c.n; } }
atEveryDepth(() => { new C3(kept3); }); log(3, [...new Set(kept3.map(o => o.read() + ":" + Object.keys(o).join("")))].sort().join());
// 4: a literal whose later members call
const kept4 = []; function make4() { const o = { a: 1 }; kept4.push(o); o.b = h1(1); o.c = "c"; return o; } atEveryDepth(make4); log(4, [...new Set(kept4.map(o => Object.keys(o).join("")))].sort().join());
// 5: an array that is filled behind a call
const kept5 = []; function make5() { const a = []; kept5.push(a); a.push(1.5); a.push(h1(1) + 0.5); a.push(3.5); } atEveryDepth(make5); log(5, [...new Set(kept5.map(a => a.length))].sort().join());
// 6: let in a block, closure made first
const kept6 = []; function make6() { kept6.push(() => late); h1(1); let late = 6; kept6.push(() => late); } atEveryDepth(make6); log(6, [...new Set(kept6.map(f => { try { return f(); } catch (e) { return e.constructor.name; } }))].sort().join());
// 7: field initializers
const kept7 = []; class A7 { constructor() { kept7.push(this); } } class B7 extends A7 { x = 1; y = h1(1); z = [7]; len() { return this.z === undefined ? -1 : this.z.length; } } atEveryDepth(() => new B7()); log(7, [...new Set(kept7.map(o => o.len() + ":" + Object.keys(o).join("")))].sort().join());
// 8: finally and the value of a counter
let open8 = 0, worst8 = 0; function with8() { open8++; try { h1(1); } finally { open8--; } } atEveryDepth(() => { with8(); worst8 = Math.max(worst8, open8); }); log(8, open8, worst8);
// 9: a getter, a string conversion and a callback at the end of the stack
const o9 = { get g() { return h1(1); }, toString() { return "s" + h1(1); } }; let done9 = 0; log(9, atEveryDepth(() => { o9.g; `${o9}`; [1].map(h1); done9++; }), done9 > 0);
// 10: a class evaluated at the end of the stack
const kept10 = []; function make10() { class K { static a = 1; static b = (kept10.push(K), h1(1)); static c = "c"; } return K; } atEveryDepth(make10); log(10, [...new Set(kept10.map(K => Object.keys(K).join("")))].sort().join());
// 11: generator and async function started at the end of the stack
function* g11() { const x = h1(1); yield x; } async function a11() { return h1(1); } let ok11 = 0; atEveryDepth(() => { g11().next(); a11().catch(() => {}); ok11++; }); log(11, ok11 > 0);
// 12: destructuring with defaults
let p12, q12; function d12() { [p12 = h1(1), q12 = h1(2)] = []; } let torn12 = false; atEveryDepth(() => { p12 = q12 = undefined; try { d12(); } finally { if ((p12 === undefined) !== (q12 === undefined)) torn12 = true; } }); log(12, typeof torn12);
