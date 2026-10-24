// Variables read before their declaration has run, and variables that a conversion, a getter or a callback changes in the middle of a function.
const log = (...a) => console.log(a.map(String).join(" "));
try { early1(); } catch (e) { log(1, e.constructor.name); } function early1() { return x1; } let x1 = 1; log(1, early1());
try { [0].forEach(() => y2); log(2, "no throw"); } catch (e) { log(2, e.constructor.name); } const y2 = 2;
try { new K3(); } catch (e) { log(3, e.constructor.name); } class K3 {}
const o4 = { get v() { return z4; } }; try { log(4, JSON.stringify(o4)); } catch (e) { log(4, e.constructor.name); } let z4 = 4; log(4, JSON.stringify(o4));
let v5 = 1; const bump5 = { valueOf() { v5 = "changed"; return 1; } }; function f5() { const before = v5; const n = 1 + bump5; return [before, v5, n].join(); } log(5, f5());
let v6 = 1; function f6(a) { const before = v6; a.sort(() => { v6++; return 0; }); return before + ":" + v6; } log(6, f6([1, 2, 3]) !== "1:1");
let v7 = 10; function f7(o) { const a = v7; const x = o.p; const b = v7; return a + "," + b + "," + x; } log(7, f7({ get p() { v7 = 20; return "p"; } }), f7({ p: 1 }));
let v8 = 0; function f8(s) { const a = v8; `${s}`; return a === v8; } log(8, f8({ toString() { v8++; return ""; } }), f8("s"));
const c9 = 1; try { eval("c9 = 2"); } catch (e) { log(9, e.constructor.name); } log(9, c9);
let v10 = 1; (0, eval)("globalThis.touch10 = 1"); eval("v10 = 'by eval'"); log(10, v10);
var v11 = 1; globalThis.v11 = "g"; log(11, v11);
function f12(a, b) { arguments[0] = "changed"; b = "B"; return [a, arguments[1], arguments.length].join(); } log(12, f12(1, 2), f12(1));
function f13(a) { "use strict"; arguments[0] = "changed"; return a; } log(13, f13(1));
function f14(a) { const g = () => { a = "inner"; }; [0].forEach(g); return a; } log(14, f14(1));
let v15 = 1; const p15 = Promise.resolve().then(() => { v15 = 2; }); async function f15() { const a = v15; await null; await null; return a + "," + v15; } f15().then(r => log(15, r));
function* g16() { let x = 1; const got = yield () => { x = "set"; }; yield x; } { const it = g16(); it.next().value(); log(16, it.next().value); }
let v17; function init17() { v17 = { n: 1 }; } function use17() { return v17.n; } try { use17(); } catch (e) { log(17, e.constructor.name); } init17(); log(17, use17());
let v18 = 5; function f18() { return v18 + 1; } log(18, f18()); v18 = "five"; log(18, f18()); v18 = 2 ** 31; log(18, f18()); v18 = -0; log(18, Object.is(v18, -0), 1 / v18); v18 = 1n; try { log(18, f18()); } catch (e) { log(18, e.constructor.name); }
const a19 = [1, 2, 3]; function f19() { let s = 0; for (let i = 0; i < a19.length; i++) { s += a19[i]; if (i === 0) trim19(); } return s; } function trim19() { a19.length = 1; } log(19, f19());
let cb20 = () => 1; function call20() { return cb20(); } log(20, call20()); cb20 = () => "two"; log(20, call20()); cb20 = null; try { call20(); } catch (e) { log(20, e.constructor.name); }
let once21; function set21(v) { once21 = v; } set21(1); log(21, once21); [2, "3"].forEach(set21); log(21, once21);
function f23(a = b23, b23 = 1) { return a; } try { f23(); } catch (e) { log(23, e.constructor.name); } log(23, f23(2));

import * as self26 from "./variables-that-change-behind-a-conversion-a-getter-or-a-callback.js"; export let exported26 = 1; log(26, self26.exported26); exported26 = 2; log(26, self26.exported26, Object.keys(self26).join()); try { self26.exported26 = 3; } catch (e) { log(26, e.constructor.name); }
