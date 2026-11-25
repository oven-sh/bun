"use strict";
let kept; const names = ["a", "b", "c"]; const above = { b: "above" }; const items = [{ a: 1, b: 2 }, { b: 3, c: 4 }, { z: 1 }]; function fill(o, i) { if (i & 1) o.b = "filled"; } function strip(o) { delete o.b; return o; } class P { constructor(a) { this.a = a; this.b = 2; } } class Q { constructor(a) { this.a = a; } b() { return 1; } }
function in_loop_plain(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; const d = delete o.b; r += d + "," + ("b" in o) + o.b + o.c + JSON.stringify(o) + ";"; } return r; }
function one_plain(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; const d = delete o.b; r += d + "," + ("b" in o) + o.b + o.c + JSON.stringify(o) + ";"; return r; }
console.log("plain", in_loop_plain(7)); console.log("plain", [0, 1, 2, 3].map(i => one_plain(i)).join("|"));
function in_loop_reads(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; r += (o.b === undefined) + "" + (o.b ?? "none") + (o.b?.x) + typeof o.b + ";"; } return r; }
function one_reads(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; r += (o.b === undefined) + "" + (o.b ?? "none") + (o.b?.x) + typeof o.b + ";"; return r; }
console.log("reads", in_loop_reads(7)); console.log("reads", [0, 1, 2, 3].map(i => one_reads(i)).join("|"));
function in_loop_has(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; delete o.b; r += o.hasOwnProperty("b") + "" + Object.hasOwn(o, "b") + Object.hasOwn(o, "a") + ";"; } return r; }
function one_has(i) { let r = ""; const o = { a: i, b: 2 }; delete o.b; r += o.hasOwnProperty("b") + "" + Object.hasOwn(o, "b") + Object.hasOwn(o, "a") + ";"; return r; }
console.log("has", in_loop_has(7)); console.log("has", [0, 1, 2, 3].map(i => one_has(i)).join("|"));
function in_loop_keys(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.a; r += Object.keys(o).join() + Object.values(o).join() + Object.entries(o).join() + ";"; } return r; }
function one_keys(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.a; r += Object.keys(o).join() + Object.values(o).join() + Object.entries(o).join() + ";"; return r; }
console.log("keys", in_loop_keys(7)); console.log("keys", [0, 1, 2, 3].map(i => one_keys(i)).join("|"));
function in_loop_for_in(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.a; for (const k in o) r += k + o[k]; r += ";"; } return r; }
function one_for_in(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.a; for (const k in o) r += k + o[k]; r += ";"; return r; }
console.log("for-in", in_loop_for_in(7)); console.log("for-in", [0, 1, 2, 3].map(i => one_for_in(i)).join("|"));
function in_loop_spread(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; const p = { ...o, z: 1 }; r += JSON.stringify(p) + ";"; } return r; }
function one_spread(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; const p = { ...o, z: 1 }; r += JSON.stringify(p) + ";"; return r; }
console.log("spread", in_loop_spread(7)); console.log("spread", [0, 1, 2, 3].map(i => one_spread(i)).join("|"));
function in_loop_rest(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; const { a, ...rest } = o; r += a + JSON.stringify(rest) + ";"; } return r; }
function one_rest(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; const { a, ...rest } = o; r += a + JSON.stringify(rest) + ";"; return r; }
console.log("rest", in_loop_rest(7)); console.log("rest", [0, 1, 2, 3].map(i => one_rest(i)).join("|"));
function in_loop_destructure(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; const { a, b = "dflt", c } = o; r += a + b + c + ";"; } return r; }
function one_destructure(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; const { a, b = "dflt", c } = o; r += a + b + c + ";"; return r; }
console.log("destructure", in_loop_destructure(7)); console.log("destructure", [0, 1, 2, 3].map(i => one_destructure(i)).join("|"));
function in_loop_again(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; o.b = i * 2; r += JSON.stringify(o) + o.b + ("b" in o) + ";"; } return r; }
function one_again(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; o.b = i * 2; r += JSON.stringify(o) + o.b + ("b" in o) + ";"; return r; }
console.log("again", in_loop_again(7)); console.log("again", [0, 1, 2, 3].map(i => one_again(i)).join("|"));
function in_loop_again_other(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; o.b = "text" + i; r += JSON.stringify(o) + o.b.length + ";"; } return r; }
function one_again_other(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; o.b = "text" + i; r += JSON.stringify(o) + o.b.length + ";"; return r; }
console.log("again-other", in_loop_again_other(7)); console.log("again-other", [0, 1, 2, 3].map(i => one_again_other(i)).join("|"));
function in_loop_twice(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; r += (delete o.b) + "" + (delete o.b) + (delete o.c) + JSON.stringify(o) + ";"; } return r; }
function one_twice(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; r += (delete o.b) + "" + (delete o.b) + (delete o.c) + JSON.stringify(o) + ";"; return r; }
console.log("twice", in_loop_twice(7)); console.log("twice", [0, 1, 2, 3].map(i => one_twice(i)).join("|"));
function in_loop_absent(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; r += (delete o.zz) + JSON.stringify(o) + ";"; } return r; }
function one_absent(i) { let r = ""; const o = { a: i, b: 2 }; r += (delete o.zz) + JSON.stringify(o) + ";"; return r; }
console.log("absent", in_loop_absent(7)); console.log("absent", [0, 1, 2, 3].map(i => one_absent(i)).join("|"));
function in_loop_maybe(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; if (i & 1) delete o.b; r += ("b" in o) + "" + o.b + JSON.stringify(o) + ";"; } return r; }
function one_maybe(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; if (i & 1) delete o.b; r += ("b" in o) + "" + o.b + JSON.stringify(o) + ";"; return r; }
console.log("maybe", in_loop_maybe(7)); console.log("maybe", [0, 1, 2, 3].map(i => one_maybe(i)).join("|"));
function in_loop_maybe_else(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; if (i & 1) delete o.b; else o.b = 7; r += ("b" in o) + "" + o.b + ";"; } return r; }
function one_maybe_else(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; if (i & 1) delete o.b; else o.b = 7; r += ("b" in o) + "" + o.b + ";"; return r; }
console.log("maybe-else", in_loop_maybe_else(7)); console.log("maybe-else", [0, 1, 2, 3].map(i => one_maybe_else(i)).join("|"));
function in_loop_maybe_ternary(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; const d = i & 1 ? delete o.b : delete o.c; r += d + "" + o.b + o.c + ";"; } return r; }
function one_maybe_ternary(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; const d = i & 1 ? delete o.b : delete o.c; r += d + "" + o.b + o.c + ";"; return r; }
console.log("maybe-ternary", in_loop_maybe_ternary(7)); console.log("maybe-ternary", [0, 1, 2, 3].map(i => one_maybe_ternary(i)).join("|"));
function in_loop_switch(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; switch (i & 3) { case 0: delete o.a; break; case 1: delete o.b; case 2: delete o.c; } r += o.a + "," + o.b + "," + o.c + ";"; } return r; }
function one_switch(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; switch (i & 3) { case 0: delete o.a; break; case 1: delete o.b; case 2: delete o.c; } r += o.a + "," + o.b + "," + o.c + ";"; return r; }
console.log("switch", in_loop_switch(7)); console.log("switch", [0, 1, 2, 3].map(i => one_switch(i)).join("|"));
function in_loop_loop(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; for (let j = 0; j < 3; j++) { r += o.b; if (j === 1) delete o.b; r += "b" in o; } r += ";"; } return r; }
function one_loop(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; for (let j = 0; j < 3; j++) { r += o.b; if (j === 1) delete o.b; r += "b" in o; } r += ";"; return r; }
console.log("loop", in_loop_loop(7)); console.log("loop", [0, 1, 2, 3].map(i => one_loop(i)).join("|"));
function in_loop_loop_again(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; for (let j = 0; j < 4; j++) { if (j & 1) o.b = j; else delete o.b; r += o.b + ("b" in o); } r += ";"; } return r; }
function one_loop_again(i) { let r = ""; const o = { a: i, b: 2 }; for (let j = 0; j < 4; j++) { if (j & 1) o.b = j; else delete o.b; r += o.b + ("b" in o); } r += ";"; return r; }
console.log("loop-again", in_loop_loop_again(7)); console.log("loop-again", [0, 1, 2, 3].map(i => one_loop_again(i)).join("|"));
function in_loop_before_loop(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; for (let j = 0; j < 3; j++) { r += ("b" in o) + "" + o.b; o.b = j; } r += ";"; } return r; }
function one_before_loop(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; for (let j = 0; j < 3; j++) { r += ("b" in o) + "" + o.b; o.b = j; } r += ";"; return r; }
console.log("before-loop", in_loop_before_loop(7)); console.log("before-loop", [0, 1, 2, 3].map(i => one_before_loop(i)).join("|"));
function in_loop_escapes_before(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; kept = o; delete o.b; r += ("b" in kept) + "" + kept.b + ";"; } return r; }
function one_escapes_before(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; kept = o; delete o.b; r += ("b" in kept) + "" + kept.b + ";"; return r; }
console.log("escapes-before", in_loop_escapes_before(7)); console.log("escapes-before", [0, 1, 2, 3].map(i => one_escapes_before(i)).join("|"));
function in_loop_escapes_after(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; kept = o; kept.b = 5; r += ("b" in o) + "" + o.b + ";"; } return r; }
function one_escapes_after(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; kept = o; kept.b = 5; r += ("b" in o) + "" + o.b + ";"; return r; }
console.log("escapes-after", in_loop_escapes_after(7)); console.log("escapes-after", [0, 1, 2, 3].map(i => one_escapes_after(i)).join("|"));
function in_loop_escapes_call(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; fill(o, i); r += ("b" in o) + "" + o.b + ";"; } return r; }
function one_escapes_call(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; fill(o, i); r += ("b" in o) + "" + o.b + ";"; return r; }
console.log("escapes-call", in_loop_escapes_call(7)); console.log("escapes-call", [0, 1, 2, 3].map(i => one_escapes_call(i)).join("|"));
function in_loop_closure(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; const set = () => { o.b = 9; }; delete o.b; r += o.b; if (i & 1) set(); r += "" + ("b" in o) + o.b + ";"; } return r; }
function one_closure(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; const set = () => { o.b = 9; }; delete o.b; r += o.b; if (i & 1) set(); r += "" + ("b" in o) + o.b + ";"; return r; }
console.log("closure", in_loop_closure(7)); console.log("closure", [0, 1, 2, 3].map(i => one_closure(i)).join("|"));
function in_loop_alias(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; const p = o; delete p.b; r += ("b" in o) + "" + o.b; p.b = 4; r += o.b + ";"; } return r; }
function one_alias(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; const p = o; delete p.b; r += ("b" in o) + "" + o.b; p.b = 4; r += o.b + ";"; return r; }
console.log("alias", in_loop_alias(7)); console.log("alias", [0, 1, 2, 3].map(i => one_alias(i)).join("|"));
function in_loop_alias_phi(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }, q = { a: 9, b: 8 }; const p = i & 1 ? o : q; delete p.b; r += o.b + "," + q.b + ("b" in o) + ";"; } return r; }
function one_alias_phi(i) { let r = ""; const o = { a: i, b: 2 }, q = { a: 9, b: 8 }; const p = i & 1 ? o : q; delete p.b; r += o.b + "," + q.b + ("b" in o) + ";"; return r; }
console.log("alias-phi", in_loop_alias_phi(7)); console.log("alias-phi", [0, 1, 2, 3].map(i => one_alias_phi(i)).join("|"));
function in_loop_try(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; try { delete o.b; if (i & 1) throw 1; o.b = 5; } catch { r += "caught" + o.b; } r += ("b" in o) + ";"; } return r; }
function one_try(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; try { delete o.b; if (i & 1) throw 1; o.b = 5; } catch { r += "caught" + o.b; } r += ("b" in o) + ";"; return r; }
console.log("try", in_loop_try(7)); console.log("try", [0, 1, 2, 3].map(i => one_try(i)).join("|"));
function in_loop_finally(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; try { if (i & 1) delete o.b; } finally { r += o.b + ("b" in o); } r += ";"; } return r; }
function one_finally(i) { let r = ""; const o = { a: i, b: 2 }; try { if (i & 1) delete o.b; } finally { r += o.b + ("b" in o); } r += ";"; return r; }
console.log("finally", in_loop_finally(7)); console.log("finally", [0, 1, 2, 3].map(i => one_finally(i)).join("|"));
function in_loop_method(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b() { return this.a; }, c: 3 }; r += o.b(); delete o.b; r += typeof o.b + ("b" in o); try { o.b(); } catch (e) { r += e.message; } r += ";"; } return r; }
function one_method(i) { let r = ""; const o = { a: i, b() { return this.a; }, c: 3 }; r += o.b(); delete o.b; r += typeof o.b + ("b" in o); try { o.b(); } catch (e) { r += e.message; } r += ";"; return r; }
console.log("method", in_loop_method(7)); console.log("method", [0, 1, 2, 3].map(i => one_method(i)).join("|"));
function in_loop_getter(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, get b() { return this.a * 2; } }; r += o.b; delete o.b; r += o.b + ("b" in o) + ";"; } return r; }
function one_getter(i) { let r = ""; const o = { a: i, get b() { return this.a * 2; } }; r += o.b; delete o.b; r += o.b + ("b" in o) + ";"; return r; }
console.log("getter", in_loop_getter(7)); console.log("getter", [0, 1, 2, 3].map(i => one_getter(i)).join("|"));
function in_loop_closure_field(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: () => i }; delete o.b; r += typeof o.b + ";"; } return r; }
function one_closure_field(i) { let r = ""; const o = { a: i, b: () => i }; delete o.b; r += typeof o.b + ";"; return r; }
console.log("closure-field", in_loop_closure_field(7)); console.log("closure-field", [0, 1, 2, 3].map(i => one_closure_field(i)).join("|"));
function in_loop_prototype_name(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, toString: 5 }; delete o.toString; r += typeof o.toString + ("toString" in o) + o.toString() + ";"; } return r; }
function one_prototype_name(i) { let r = ""; const o = { a: i, toString: 5 }; delete o.toString; r += typeof o.toString + ("toString" in o) + o.toString() + ";"; return r; }
console.log("prototype-name", in_loop_prototype_name(7)); console.log("prototype-name", [0, 1, 2, 3].map(i => one_prototype_name(i)).join("|"));
function in_loop_prototype_name_has(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, hasOwnProperty: 5 }; delete o.hasOwnProperty; r += o.hasOwnProperty("a") + "" + o.hasOwnProperty("hasOwnProperty") + ";"; } return r; }
function one_prototype_name_has(i) { let r = ""; const o = { a: i, hasOwnProperty: 5 }; delete o.hasOwnProperty; r += o.hasOwnProperty("a") + "" + o.hasOwnProperty("hasOwnProperty") + ";"; return r; }
console.log("prototype-name-has", in_loop_prototype_name_has(7)); console.log("prototype-name-has", [0, 1, 2, 3].map(i => one_prototype_name_has(i)).join("|"));
function in_loop_computed(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o[names[i % 3]]; r += JSON.stringify(o) + ("b" in o) + o.b + ";"; } return r; }
function one_computed(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o[names[i % 3]]; r += JSON.stringify(o) + ("b" in o) + o.b + ";"; return r; }
console.log("computed", in_loop_computed(7)); console.log("computed", [0, 1, 2, 3].map(i => one_computed(i)).join("|"));
function in_loop_number_key(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { 0: i, 1: 2, x: 3 }; delete o[1]; r += (1 in o) + JSON.stringify(o) + ";"; } return r; }
function one_number_key(i) { let r = ""; const o = { 0: i, 1: 2, x: 3 }; delete o[1]; r += (1 in o) + JSON.stringify(o) + ";"; return r; }
console.log("number-key", in_loop_number_key(7)); console.log("number-key", [0, 1, 2, 3].map(i => one_number_key(i)).join("|"));
function in_loop_in_name(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; r += (names[i % 3] in o) + "" + o[names[i % 3]] + ";"; } return r; }
function one_in_name(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; r += (names[i % 3] in o) + "" + o[names[i % 3]] + ";"; return r; }
console.log("in-name", in_loop_in_name(7)); console.log("in-name", [0, 1, 2, 3].map(i => one_in_name(i)).join("|"));
function in_loop_descriptor(n) { let r = ""; for (let i = 0; i < n; i++) { const d = { value: i, enumerable: true, writable: true }; delete d.enumerable; const o = {}; Object.defineProperty(o, "x", d); r += JSON.stringify(o) + JSON.stringify(Object.getOwnPropertyDescriptor(o, "x")) + ";"; } return r; }
function one_descriptor(i) { let r = ""; const d = { value: i, enumerable: true, writable: true }; delete d.enumerable; const o = {}; Object.defineProperty(o, "x", d); r += JSON.stringify(o) + JSON.stringify(Object.getOwnPropertyDescriptor(o, "x")) + ";"; return r; }
console.log("descriptor", in_loop_descriptor(7)); console.log("descriptor", [0, 1, 2, 3].map(i => one_descriptor(i)).join("|"));
function in_loop_descriptor_value(n) { let r = ""; for (let i = 0; i < n; i++) { const d = { value: i, enumerable: true }; delete d.value; const o = {}; Object.defineProperty(o, "x", d); r += JSON.stringify(Object.getOwnPropertyDescriptor(o, "x")) + ";"; } return r; }
function one_descriptor_value(i) { let r = ""; const d = { value: i, enumerable: true }; delete d.value; const o = {}; Object.defineProperty(o, "x", d); r += JSON.stringify(Object.getOwnPropertyDescriptor(o, "x")) + ";"; return r; }
console.log("descriptor-value", in_loop_descriptor_value(7)); console.log("descriptor-value", [0, 1, 2, 3].map(i => one_descriptor_value(i)).join("|"));
function in_loop_assign(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; const t = Object.assign({ b: "kept" }, o); r += JSON.stringify(t) + ";"; } return r; }
function one_assign(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; const t = Object.assign({ b: "kept" }, o); r += JSON.stringify(t) + ";"; return r; }
console.log("assign", in_loop_assign(7)); console.log("assign", [0, 1, 2, 3].map(i => one_assign(i)).join("|"));
function in_loop_assign_into(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.b; Object.assign(o, { b: 8 }); r += JSON.stringify(o) + ";"; } return r; }
function one_assign_into(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.b; Object.assign(o, { b: 8 }); r += JSON.stringify(o) + ";"; return r; }
console.log("assign-into", in_loop_assign_into(7)); console.log("assign-into", [0, 1, 2, 3].map(i => one_assign_into(i)).join("|"));
function in_loop_freeze(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; Object.freeze(o); try { delete o.b; } catch (e) { r += e.constructor.name; } r += o.b + ";"; } return r; }
function one_freeze(i) { let r = ""; const o = { a: i, b: 2 }; Object.freeze(o); try { delete o.b; } catch (e) { r += e.constructor.name; } r += o.b + ";"; return r; }
console.log("freeze", in_loop_freeze(7)); console.log("freeze", [0, 1, 2, 3].map(i => one_freeze(i)).join("|"));
function in_loop_seal_after(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; delete o.b; Object.seal(o); try { o.b = 1; } catch (e) { r += e.constructor.name; } r += ("b" in o) + ";"; } return r; }
function one_seal_after(i) { let r = ""; const o = { a: i, b: 2 }; delete o.b; Object.seal(o); try { o.b = 1; } catch (e) { r += e.constructor.name; } r += ("b" in o) + ";"; return r; }
console.log("seal-after", in_loop_seal_after(7)); console.log("seal-after", [0, 1, 2, 3].map(i => one_seal_after(i)).join("|"));
function in_loop_nonconfigurable(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; Object.defineProperty(o, "b", { configurable: false }); try { delete o.b; } catch (e) { r += e.constructor.name; } r += o.b + ";"; } return r; }
function one_nonconfigurable(i) { let r = ""; const o = { a: i, b: 2 }; Object.defineProperty(o, "b", { configurable: false }); try { delete o.b; } catch (e) { r += e.constructor.name; } r += o.b + ";"; return r; }
console.log("nonconfigurable", in_loop_nonconfigurable(7)); console.log("nonconfigurable", [0, 1, 2, 3].map(i => one_nonconfigurable(i)).join("|"));
function in_loop_set_prototype(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; delete o.b; Object.setPrototypeOf(o, { b: "above" }); r += o.b + ("b" in o) + Object.hasOwn(o, "b") + ";"; } return r; }
function one_set_prototype(i) { let r = ""; const o = { a: i, b: 2 }; delete o.b; Object.setPrototypeOf(o, { b: "above" }); r += o.b + ("b" in o) + Object.hasOwn(o, "b") + ";"; return r; }
console.log("set-prototype", in_loop_set_prototype(7)); console.log("set-prototype", [0, 1, 2, 3].map(i => one_set_prototype(i)).join("|"));
function in_loop_literal_prototype(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { __proto__: above, a: i, b: 2 }; delete o.b; r += o.b + ("b" in o) + Object.hasOwn(o, "b") + ";"; } return r; }
function one_literal_prototype(i) { let r = ""; const o = { __proto__: above, a: i, b: 2 }; delete o.b; r += o.b + ("b" in o) + Object.hasOwn(o, "b") + ";"; return r; }
console.log("literal-prototype", in_loop_literal_prototype(7)); console.log("literal-prototype", [0, 1, 2, 3].map(i => one_literal_prototype(i)).join("|"));
function in_loop_class(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new P(i); delete o.b; r += o.b + ("b" in o) + JSON.stringify(o) + ";"; } return r; }
function one_class(i) { let r = ""; const o = new P(i); delete o.b; r += o.b + ("b" in o) + JSON.stringify(o) + ";"; return r; }
console.log("class", in_loop_class(7)); console.log("class", [0, 1, 2, 3].map(i => one_class(i)).join("|"));
function in_loop_class_above(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new Q(i); o.b = 4; r += o.b; delete o.b; r += typeof o.b + ("b" in o) + ";"; } return r; }
function one_class_above(i) { let r = ""; const o = new Q(i); o.b = 4; r += o.b; delete o.b; r += typeof o.b + ("b" in o) + ";"; return r; }
console.log("class-above", in_loop_class_above(7)); console.log("class-above", [0, 1, 2, 3].map(i => one_class_above(i)).join("|"));
function in_loop_returned(n) { let r = ""; for (let i = 0; i < n; i++) { const o = strip({ a: i, b: 2, c: 3 }); r += JSON.stringify(o) + ("b" in o) + o.b + ";"; } return r; }
function one_returned(i) { let r = ""; const o = strip({ a: i, b: 2, c: 3 }); r += JSON.stringify(o) + ("b" in o) + o.b + ";"; return r; }
console.log("returned", in_loop_returned(7)); console.log("returned", [0, 1, 2, 3].map(i => one_returned(i)).join("|"));
function in_loop_copied(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { ...items[i % 3] }; delete o.b; r += JSON.stringify(o) + ("b" in o) + o.b + ";"; } return r; }
function one_copied(i) { let r = ""; const o = { ...items[i % 3] }; delete o.b; r += JSON.stringify(o) + ("b" in o) + o.b + ";"; return r; }
console.log("copied", in_loop_copied(7)); console.log("copied", [0, 1, 2, 3].map(i => one_copied(i)).join("|"));
function in_loop_nested(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: { x: i, y: 2 }, b: 2 }; delete o.a.x; r += JSON.stringify(o) + ("x" in o.a) + o.a.x + ";"; delete o.a; r += o.a?.y + ";"; } return r; }
function one_nested(i) { let r = ""; const o = { a: { x: i, y: 2 }, b: 2 }; delete o.a.x; r += JSON.stringify(o) + ("x" in o.a) + o.a.x + ";"; delete o.a; r += o.a?.y + ";"; return r; }
console.log("nested", in_loop_nested(7)); console.log("nested", [0, 1, 2, 3].map(i => one_nested(i)).join("|"));
function in_loop_list(n) { let r = ""; for (let i = 0; i < n; i++) { const o = [{ a: i, b: 1 }]; delete o[0].b; r += JSON.stringify(o) + ("b" in o[0]) + ";"; } return r; }
function one_list(i) { let r = ""; const o = [{ a: i, b: 1 }]; delete o[0].b; r += JSON.stringify(o) + ("b" in o[0]) + ";"; return r; }
console.log("list", in_loop_list(7)); console.log("list", [0, 1, 2, 3].map(i => one_list(i)).join("|"));
function in_loop_symbol(n) { let r = ""; for (let i = 0; i < n; i++) { const k = Symbol("k"); const o = { [k]: i, b: 1 }; delete o[k]; r += (k in o) + "" + o[k] + ";"; } return r; }
function one_symbol(i) { let r = ""; const k = Symbol("k"); const o = { [k]: i, b: 1 }; delete o[k]; r += (k in o) + "" + o[k] + ";"; return r; }
console.log("symbol", in_loop_symbol(7)); console.log("symbol", [0, 1, 2, 3].map(i => one_symbol(i)).join("|"));
function in_loop_undefined(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: undefined, b: i }; r += ("a" in o); delete o.a; r += ("a" in o) + "" + o.a + ";"; } return r; }
function one_undefined(i) { let r = ""; const o = { a: undefined, b: i }; r += ("a" in o); delete o.a; r += ("a" in o) + "" + o.a + ";"; return r; }
console.log("undefined", in_loop_undefined(7)); console.log("undefined", [0, 1, 2, 3].map(i => one_undefined(i)).join("|"));
function in_loop_null(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: null, b: i }; delete o.a; r += o.a + ("a" in o) + (o.a === null) + (o.a == null) + ";"; } return r; }
function one_null(i) { let r = ""; const o = { a: null, b: i }; delete o.a; r += o.a + ("a" in o) + (o.a === null) + (o.a == null) + ";"; return r; }
console.log("null", in_loop_null(7)); console.log("null", [0, 1, 2, 3].map(i => one_null(i)).join("|"));
function in_loop_double(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i + 0.5, b: i }; delete o.a; r += o.a + ("a" in o); o.a = i; r += o.a + ";"; } return r; }
function one_double(i) { let r = ""; const o = { a: i + 0.5, b: i }; delete o.a; r += o.a + ("a" in o); o.a = i; r += o.a + ";"; return r; }
console.log("double", in_loop_double(7)); console.log("double", [0, 1, 2, 3].map(i => one_double(i)).join("|"));
function in_loop_compare(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: i }; delete o.a; r += (o.a === o.b) + "" + (o.a === undefined) + (o.a !== null) + (o.a < 3) + (o.a + 1) + ";"; } return r; }
function one_compare(i) { let r = ""; const o = { a: i, b: i }; delete o.a; r += (o.a === o.b) + "" + (o.a === undefined) + (o.a !== null) + (o.a < 3) + (o.a + 1) + ";"; return r; }
console.log("compare", in_loop_compare(7)); console.log("compare", [0, 1, 2, 3].map(i => one_compare(i)).join("|"));
function in_loop_logical(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: i }; delete o.a; o.a ??= 7; o.b ||= 8; r += o.a + "," + o.b + JSON.stringify(o) + ";"; } return r; }
function one_logical(i) { let r = ""; const o = { a: i, b: i }; delete o.a; o.a ??= 7; o.b ||= 8; r += o.a + "," + o.b + JSON.stringify(o) + ";"; return r; }
console.log("logical", in_loop_logical(7)); console.log("logical", [0, 1, 2, 3].map(i => one_logical(i)).join("|"));
function in_loop_increment(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: i }; delete o.a; o.a++; o.b++; r += o.a + "," + o.b + ";"; } return r; }
function one_increment(i) { let r = ""; const o = { a: i, b: i }; delete o.a; o.a++; o.b++; r += o.a + "," + o.b + ";"; return r; }
console.log("increment", in_loop_increment(7)); console.log("increment", [0, 1, 2, 3].map(i => one_increment(i)).join("|"));
function in_loop_optional_call(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { f: () => i, b: i }; delete o.f; r += o.f?.() + ";"; } return r; }
function one_optional_call(i) { let r = ""; const o = { f: () => i, b: i }; delete o.f; r += o.f?.() + ";"; return r; }
console.log("optional-call", in_loop_optional_call(7)); console.log("optional-call", [0, 1, 2, 3].map(i => one_optional_call(i)).join("|"));
function in_loop_stringify(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: i }; delete o.b; r += String(o) + `${o.b}` + o.toString() + ";"; } return r; }
function one_stringify(i) { let r = ""; const o = { a: i, b: i }; delete o.b; r += String(o) + `${o.b}` + o.toString() + ";"; return r; }
console.log("stringify", in_loop_stringify(7)); console.log("stringify", [0, 1, 2, 3].map(i => one_stringify(i)).join("|"));
function in_loop_structured(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: i }; delete o.b; r += JSON.stringify(structuredClone(o)) + ";"; } return r; }
function one_structured(i) { let r = ""; const o = { a: i, b: i }; delete o.b; r += JSON.stringify(structuredClone(o)) + ";"; return r; }
console.log("structured", in_loop_structured(7)); console.log("structured", [0, 1, 2, 3].map(i => one_structured(i)).join("|"));
function in_loop_instance(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: i }; delete o.b; r += (o instanceof Object) + "" + (Object.getPrototypeOf(o) === Object.prototype) + ";"; } return r; }
function one_instance(i) { let r = ""; const o = { a: i, b: i }; delete o.b; r += (o instanceof Object) + "" + (Object.getPrototypeOf(o) === Object.prototype) + ";"; return r; }
console.log("instance", in_loop_instance(7)); console.log("instance", [0, 1, 2, 3].map(i => one_instance(i)).join("|"));
function in_loop_generator(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: i }; function* g() { delete o.b; yield o.b; o.b = 3; yield o.b; } for (const x of g()) r += x + ("b" in o); r += ";"; } return r; }
function one_generator(i) { let r = ""; const o = { a: i, b: i }; function* g() { delete o.b; yield o.b; o.b = 3; yield o.b; } for (const x of g()) r += x + ("b" in o); r += ";"; return r; }
console.log("generator", in_loop_generator(7)); console.log("generator", [0, 1, 2, 3].map(i => one_generator(i)).join("|"));
function in_loop_thrown(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: i }; delete o.b; try { o.b.x; } catch (e) { r += e.constructor.name; } try { o.b(); } catch (e) { r += e.message; } r += ";"; } return r; }
function one_thrown(i) { let r = ""; const o = { a: i, b: i }; delete o.b; try { o.b.x; } catch (e) { r += e.constructor.name; } try { o.b(); } catch (e) { r += e.message; } r += ";"; return r; }
console.log("thrown", in_loop_thrown(7)); console.log("thrown", [0, 1, 2, 3].map(i => one_thrown(i)).join("|"));
function in_loop_delete_free(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; delete o.a; delete o.b; delete o.c; r += JSON.stringify(o) + ("a" in o) + ("c" in o) + Object.keys(o).length + ";"; } return r; }
function one_delete_free(i) { let r = ""; const o = { a: i, b: 2, c: 3 }; delete o.a; delete o.b; delete o.c; r += JSON.stringify(o) + ("a" in o) + ("c" in o) + Object.keys(o).length + ";"; return r; }
console.log("delete-free", in_loop_delete_free(7)); console.log("delete-free", [0, 1, 2, 3].map(i => one_delete_free(i)).join("|"));
function in_loop_labels(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; out: { if (i & 1) break out; delete o.b; } r += o.b + ("b" in o) + ";"; } return r; }
function one_labels(i) { let r = ""; const o = { a: i, b: 2 }; out: { if (i & 1) break out; delete o.b; } r += o.b + ("b" in o) + ";"; return r; }
console.log("labels", in_loop_labels(7)); console.log("labels", [0, 1, 2, 3].map(i => one_labels(i)).join("|"));
