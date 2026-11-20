// Values that factories made once captured, read in loops that call the closures, before and behind their making.
const N = process.argv.length * 3; const list = [4, 1, 3, 0, 2, 5]; const said = []; function say(x) { said.push(x); } function other(x) { said.push(typeof x); } function maybe(n) { return n > 1000 ? 1 : undefined; }
function num(x) { return typeof x === "number" ? (x === x ? x : 9) : typeof x === "string" ? x.length : typeof x === "bigint" ? 4 : x === true ? 1 : x && typeof x === "object" ? (Array.isArray(x) ? x.length : 2) : typeof x === "function" ? 6 : 0; }
function mix(h, v) { return (Math.imul(h, 33) + (v | 0) | 0) & 0xfffffff; }
let total = 0; function test(name, f) { let a; try { a = String(f()); } catch (e) { a = "!" + e.constructor.name; } console.log(name, a, said.length); said.length = 0; total++; }
function run_f0(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f0(x, s); } return s; }
function poke_f0() { said.push(1); if (set_f0) set_f0(7); }
test("f0e", () => run_f0(3)); test("f0z", () => run_f0(0));
let set_f0; const c_f0 = (() => { let on = N > 50 ? 1 : undefined; set_f0 = x => { on = x; }; return (k, s) => { s += num(on); return s; }; })();
test("f0", () => run_f0(6)); test("f0b", () => run_f0(0)); test("f0c", () => [run_f0(5), run_f0(1)]);
function run_f1(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f1(k, s); if (k === 3) poke_f1(); } return s; }
function poke_f1() { said.push(1);  }
const c_f1 = (() => { const on = N > 50 ? 'a' : 2; const two = num(on) + 1; return (k, s) => { for (let j = 0; j < 3; j++) s += num(on) + j; return s + two; }; })();
test("f1", () => run_f1(6)); test("f1b", () => run_f1(0)); test("f1c", () => [run_f1(5), run_f1(1)]);
function run_f2(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f2(k, s); if (k === 3) poke_f2(); } return s; }
function poke_f2() { said.push(1);  }
test("f2e", () => run_f2(3)); test("f2z", () => run_f2(0));
const c_f2 = (() => { const on = Symbol.for('q' + N); const two = num(on) + 1; return (k, s) => { s += on?.v ?? 1; return s + two; }; })();
test("f2", () => run_f2(6)); test("f2b", () => run_f2(0)); test("f2c", () => [run_f2(5), run_f2(1)]);
function run_f3(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f3(k, s); if (k === 3) poke_f3(); } return s; }
function poke_f3() { said.push(1);  }
function make_f3(on) { return (k, s) => { if (on) s += 100; return s; }; }
let c_f3 = make_f3(N > 50); if (N > 70) c_f3 = make_f3(0);
test("f3", () => run_f3(6)); test("f3b", () => run_f3(0)); test("f3c", () => [run_f3(5), run_f3(1)]);
function run_f4(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f4(k, s); k++; } return s; }
function poke_f4() { said.push(1);  }
const c_f4 = (() => { const on = Symbol.for('q' + N); const two = num(on) + 1; return (k, s) => { s += on ? k : -k; return s + two; }; })();
test("f4", () => run_f4(6)); test("f4b", () => run_f4(0)); test("f4c", () => [run_f4(5), run_f4(1)]);
function run_f5(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f5(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f5() { said.push(1); if (set_f5) set_f5(7); }
let set_f5; const c_f5 = (() => { let on = [N, 2]; set_f5 = x => { on = x; }; return (k, s) => { if (on) s += 100; return s; }; })();
test("f5", () => run_f5(6)); test("f5b", () => run_f5(0)); test("f5c", () => [run_f5(5), run_f5(1)]);
function run_f6(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f6(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f6() { said.push(1);  }
function make_f6(on) { return (k, s) => { switch (typeof on) { case 'number': s += 1; break; case 'string': s += 2; break; default: s += 3; } return s; }; }
let c_f6 = make_f6((z) => z + N); if (N > 70) c_f6 = make_f6(0);
test("f6", () => run_f6(6)); test("f6b", () => run_f6(0)); test("f6c", () => [run_f6(5), run_f6(1)]);
function run_f7(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f7(k, s); if (k === 3) poke_f7(); } return s; }
function poke_f7() { said.push(1);  }
test("f7e", () => run_f7(3)); test("f7z", () => run_f7(0));
const c_f7 = (function () { const on = { v: N }; function inner(k, s) { s += num(on); return s; } return inner; })();
test("f7", () => run_f7(6)); test("f7b", () => run_f7(0)); test("f7c", () => [run_f7(5), run_f7(1)]);
function run_f8(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f8(x, s); }); return s; }
function poke_f8() { said.push(1);  }
function make_f8(name) { const on = new Map([[1, N]]); return (k, s) => { if (on && k > 2) say(k); return s; }; }
const c_f8 = make_f8("a");
test("f8", () => run_f8(6)); test("f8b", () => run_f8(0)); test("f8c", () => [run_f8(5), run_f8(1)]);
function* gen_f9(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f9(k, s); yield s; } }
function run_f9(n) { let t = 0; for (const v of gen_f9(n)) t = mix(t, num(v)); return t; }
function poke_f9() { said.push(1); if (set_f9) set_f9(7); }
let set_f9; const c_f9 = (() => { let on = 't' + N; set_f9 = x => { on = x; }; return (k, s) => { if (on && k > 2) say(k); return s; }; })();
test("f9", () => run_f9(6)); test("f9b", () => run_f9(0)); test("f9c", () => [run_f9(5), run_f9(1)]);
function* gen_f10(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f10(k, s); yield s; } }
function run_f10(n) { let t = 0; for (const v of gen_f10(n)) t = mix(t, num(v)); return t; }
function poke_f10() { said.push(1);  }
test("f10e", () => run_f10(3)); test("f10z", () => run_f10(0));
function make_f10(name) { const on = new Map([[1, N]]); let count = 0; return (k, s) => { count++; try { if (on) throw k; s += 1; } catch (e) { s += e; } return s + count; }; }
const c_f10 = make_f10("a");
test("f10", () => run_f10(6)); test("f10b", () => run_f10(0)); test("f10c", () => [run_f10(5), run_f10(1)]);
function run_f11(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f11(k, s); return s; }
function poke_f11() { said.push(1);  }
function make_f11(on) { return { call(k, s) { s += list.filter(x => x > num(on)).length; return s; } }; }
const o_f11 = make_f11(N * 0.5); const c_f11 = (k, s) => o_f11.call(k, s);
test("f11", () => run_f11(6)); test("f11b", () => run_f11(0)); test("f11c", () => [run_f11(5), run_f11(1)]);
function run_f12(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f12(k, s); if (k === 3) poke_f12(); } return s; }
function poke_f12() { said.push(1);  }
test("f12e", () => run_f12(3)); test("f12z", () => run_f12(0));
const c_f12 = (() => { const on = undefined; const two = num(on) + 1; return (k, s) => { if (!on) s += 1; return s + two; }; })();
test("f12", () => run_f12(6)); test("f12b", () => run_f12(0)); test("f12c", () => [run_f12(5), run_f12(1)]);
function run_f13(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f13(x, s); } return s; }
function poke_f13() { said.push(1); if (set_f13) set_f13(7); }
test("f13e", () => run_f13(3)); test("f13z", () => run_f13(0));
let set_f13; const c_f13 = (() => { let on = N * 0.5; set_f13 = x => { on = x; }; return (k, s) => { for (let j = 0; j < 3; j++) s += num(on) + j; return s; }; })();
test("f13", () => run_f13(6)); test("f13b", () => run_f13(0)); test("f13c", () => [run_f13(5), run_f13(1)]);
function run_f14(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f14(k, s); k++; } return s; }
function poke_f14() { said.push(1);  }
test("f14e", () => run_f14(3)); test("f14z", () => run_f14(0));
function make_f14(on) { return (k, s) => { s += list.filter(x => x > num(on)).length; return s; }; }
const c_f14 = make_f14(N > 50);
test("f14", () => run_f14(6)); test("f14b", () => run_f14(0)); test("f14c", () => [run_f14(5), run_f14(1)]);
function run_f15(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f15(k, s); if (k === 3) poke_f15(); } return s; }
function poke_f15() { said.push(1);  }
function make_f15(on) { return { call(k, s) { if (on === undefined) return s; s += 2; return s; } }; }
const o_f15 = make_f15(-0); const c_f15 = (k, s) => o_f15.call(k, s);
test("f15", () => run_f15(6)); test("f15b", () => run_f15(0)); test("f15c", () => [run_f15(5), run_f15(1)]);
function run_f16(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f16(k, s); if (k === 3) poke_f16(); } return s; }
function poke_f16() { said.push(1);  }
function make_f16(on) { return (k, s) => { s = mix(s, num(on) + k); return s; }; }
let c_f16 = make_f16(N > 50 ? 1 : undefined); if (N > 70) c_f16 = make_f16(0);
test("f16", () => run_f16(6)); test("f16b", () => run_f16(0)); test("f16c", () => [run_f16(5), run_f16(1)]);
function run_f17(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f17(x, s); } return s; }
function poke_f17() { said.push(1);  }
test("f17e", () => run_f17(3)); test("f17z", () => run_f17(0));
function make_f17(name) { const on = { v: N }; return (k, s) => { if (on) s += 100; return s; }; }
const c_f17 = make_f17("a");
test("f17", () => run_f17(6)); test("f17b", () => run_f17(0)); test("f17c", () => [run_f17(5), run_f17(1)]);
function run_f18(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f18(x, s); }); return s; }
function poke_f18() { said.push(1);  }
function make_f18(name) { const on = N > 50 ? 1 : undefined; let count = 0; return (k, s) => { count++; return s + num(on); return s + count; }; }
const c_f18 = make_f18("a");
test("f18", () => run_f18(6)); test("f18b", () => run_f18(0)); test("f18c", () => [run_f18(5), run_f18(1)]);
function run_f19(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f19(k, s); k++; } return s; }
function poke_f19() { said.push(1);  }
class H_f19 { static on = N + 3; static c = (() => { const on = H_f19.on; return (k, s) => { if (!on) s += 1; return s; }; })(); }
const c_f19 = H_f19.c;
test("f19", () => run_f19(6)); test("f19b", () => run_f19(0)); test("f19c", () => [run_f19(5), run_f19(1)]);
function run_f20(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f20(k, s); return s; }
function poke_f20() { said.push(1);  }
test("f20e", () => run_f20(3)); test("f20z", () => run_f20(0));
const c_f20 = (() => { const on = Symbol.for('q' + N); const two = num(on) + 1; return (k, s) => { if (on && k > 2) say(k); return s + two; }; })();
test("f20", () => run_f20(6)); test("f20b", () => run_f20(0)); test("f20c", () => [run_f20(5), run_f20(1)]);
function run_f21(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f21(k, s); if (k === 3) poke_f21(); } return s; }
function poke_f21() { said.push(1);  }
function make_f21(name) { const on = [N, 2]; return (k, s) => { if (on && k > 2) say(k); return s; }; }
const c_f21 = make_f21("a");
test("f21", () => run_f21(6)); test("f21b", () => run_f21(0)); test("f21c", () => [run_f21(5), run_f21(1)]);
function run_f22(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f22(x, s); } return s; }
function poke_f22() { said.push(1);  }
function make_f22(name) { const on = N * 0.5; let count = 0; return (k, s) => { count++; s += on ? k : -k; return s + count; }; }
const c_f22 = make_f22("a");
test("f22", () => run_f22(6)); test("f22b", () => run_f22(0)); test("f22c", () => [run_f22(5), run_f22(1)]);
function run_f23(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f23(x, s); } return s; }
function poke_f23() { said.push(1);  }
function make_f23(on) { return { call(k, s) { try { if (on) throw k; s += 1; } catch (e) { s += e; } return s; } }; }
const o_f23 = make_f23(N > 50 ? 'a' : 2); const c_f23 = (k, s) => o_f23.call(k, s);
test("f23", () => run_f23(6)); test("f23b", () => run_f23(0)); test("f23c", () => [run_f23(5), run_f23(1)]);
function run_f24(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f24(x, s); }); return s; }
function poke_f24() { said.push(1);  }
class H_f24 { static on = 't' + N; static c = (() => { const on = H_f24.on; return (k, s) => { s += num(on); return s; }; })(); }
const c_f24 = H_f24.c;
test("f24", () => run_f24(6)); test("f24b", () => run_f24(0)); test("f24c", () => [run_f24(5), run_f24(1)]);
function run_f25(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f25(k, s); k++; } return s; }
function poke_f25() { said.push(1);  }
function make_f25(on) { return (k, s) => { for (let j = 0; j < 3; j++) s += num(on) + j; return s; }; }
const c_f25 = make_f25(N > 50);
test("f25", () => run_f25(6)); test("f25b", () => run_f25(0)); test("f25c", () => [run_f25(5), run_f25(1)]);
function run_f26(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f26(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f26() { said.push(1);  }
function make_f26(on) { return (k, s) => { s = mix(s, num(on) + k); return s; }; }
let c_f26 = make_f26(N * 0.5); if (N > 70) c_f26 = make_f26(0);
test("f26", () => run_f26(6)); test("f26b", () => run_f26(0)); test("f26c", () => [run_f26(5), run_f26(1)]);
function run_f27(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f27(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f27() { said.push(1); if (set_f27) set_f27(7); }
let set_f27; const c_f27 = (() => { let on = { v: N }; set_f27 = x => { on = x; }; return (k, s) => { if (!on) s += 1; return s; }; })();
test("f27", () => run_f27(6)); test("f27b", () => run_f27(0)); test("f27c", () => [run_f27(5), run_f27(1)]);
function* gen_f28(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f28(k, s); yield s; } }
function run_f28(n) { let t = 0; for (const v of gen_f28(n)) t = mix(t, num(v)); return t; }
function poke_f28() { said.push(1); if (set_f28) set_f28(7); }
let set_f28; const c_f28 = (() => { let on = -0; set_f28 = x => { on = x; }; return (k, s) => { s += on ? k : -k; return s; }; })();
test("f28", () => run_f28(6)); test("f28b", () => run_f28(0)); test("f28c", () => [run_f28(5), run_f28(1)]);
function run_f29(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f29(x, s); }); return s; }
function poke_f29() { said.push(1);  }
function make_f29(on) { return (k, s) => { s = mix(s, num(on) + k); return s; }; }
let c_f29 = make_f29(new Map([[1, N]])); if (N > 70) c_f29 = make_f29(0);
test("f29", () => run_f29(6)); test("f29b", () => run_f29(0)); test("f29c", () => [run_f29(5), run_f29(1)]);
function run_f30(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f30(x, s); }); return s; }
function poke_f30() { said.push(1);  }
function make_f30() { const on = maybe(N); const inner = (k, s) => { s = mix(s, num(on) + k); return s; }; return (k, s) => inner(k, s); }
const c_f30 = make_f30();
test("f30", () => run_f30(6)); test("f30b", () => run_f30(0)); test("f30c", () => [run_f30(5), run_f30(1)]);
function run_f31(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f31(k, s); return s; }
function poke_f31() { said.push(1);  }
test("f31e", () => run_f31(3)); test("f31z", () => run_f31(0));
function make_f31() { const on = N > 50 ? 'a' : 2; const inner = (k, s) => { return s + num(on); return s; }; return (k, s) => inner(k, s); }
const c_f31 = make_f31();
test("f31", () => run_f31(6)); test("f31b", () => run_f31(0)); test("f31c", () => [run_f31(5), run_f31(1)]);
function run_f32(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f32(x, s); } return s; }
function poke_f32() { said.push(1);  }
const c_f32 = (() => { const on = maybe(N); const two = num(on) + 1; return (k, s) => { s += list.filter(x => x > num(on)).length; return s + two; }; })();
test("f32", () => run_f32(6)); test("f32b", () => run_f32(0)); test("f32c", () => [run_f32(5), run_f32(1)]);
function run_f33(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f33(k, s); if (k === 3) poke_f33(); } return s; }
function poke_f33() { said.push(1);  }
function make_f33() { const on = N > 50 ? 1 : undefined; const inner = (k, s) => { switch (typeof on) { case 'number': s += 1; break; case 'string': s += 2; break; default: s += 3; } return s; }; return (k, s) => inner(k, s); }
const c_f33 = make_f33();
test("f33", () => run_f33(6)); test("f33b", () => run_f33(0)); test("f33c", () => [run_f33(5), run_f33(1)]);
function run_f34(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f34(k, s); k++; } return s; }
function poke_f34() { said.push(1);  }
function make_f34(on) { return (k, s) => { s = mix(s, num(on) + k); return s; }; }
let c_f34 = make_f34(N > 50 ? 1 : undefined); if (N > 70) c_f34 = make_f34(0);
test("f34", () => run_f34(6)); test("f34b", () => run_f34(0)); test("f34c", () => [run_f34(5), run_f34(1)]);
function* gen_f35(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f35(k, s); yield s; } }
function run_f35(n) { let t = 0; for (const v of gen_f35(n)) t = mix(t, num(v)); return t; }
function poke_f35() { said.push(1);  }
const c_f35 = (function () { const on = maybe(N); function inner(k, s) { s = mix(s, num(on) + k); return s; } return inner; })();
test("f35", () => run_f35(6)); test("f35b", () => run_f35(0)); test("f35c", () => [run_f35(5), run_f35(1)]);
function run_f36(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f36(k, s) & 0xffffff; return s; }
function poke_f36() { said.push(1); if (set_f36) set_f36(7); }
let set_f36; const c_f36 = (() => { let on = BigInt(N); set_f36 = x => { on = x; }; return (k, s) => { if (k === 4) other(on); s++; return s; }; })();
test("f36", () => run_f36(6)); test("f36b", () => run_f36(0)); test("f36c", () => [run_f36(5), run_f36(1)]);
function run_f37(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f37(x, s); }); return s; }
function poke_f37() { said.push(1);  }
function make_f37() { const on = { v: N }; const inner = (k, s) => { if (on === undefined) return s; s += 2; return s; }; return (k, s) => inner(k, s); }
const c_f37 = make_f37();
test("f37", () => run_f37(6)); test("f37b", () => run_f37(0)); test("f37c", () => [run_f37(5), run_f37(1)]);
function run_f38(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f38(k, s); k++; } return s; }
function poke_f38() { said.push(1);  }
test("f38e", () => run_f38(3)); test("f38z", () => run_f38(0));
class H_f38 { static on = (z) => z + N; static c = (() => { const on = H_f38.on; return (k, s) => { if (!on) s += 1; return s; }; })(); }
const c_f38 = H_f38.c;
test("f38", () => run_f38(6)); test("f38b", () => run_f38(0)); test("f38c", () => [run_f38(5), run_f38(1)]);
function run_f39(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f39(x, s); }); return s; }
function poke_f39() { said.push(1);  }
class H_f39 { static on = Symbol.for('q' + N); static c = (() => { const on = H_f39.on; return (k, s) => { s += on?.v ?? 1; return s; }; })(); }
const c_f39 = H_f39.c;
test("f39", () => run_f39(6)); test("f39b", () => run_f39(0)); test("f39c", () => [run_f39(5), run_f39(1)]);
function run_f40(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f40(k, s) & 0xffffff; return s; }
function poke_f40() { said.push(1);  }
test("f40e", () => run_f40(3)); test("f40z", () => run_f40(0));
function make_f40(on) { return (k, s) => { for (let j = 0; j < 3; j++) s += num(on) + j; return s; }; }
const c_f40 = make_f40(NaN);
test("f40", () => run_f40(6)); test("f40b", () => run_f40(0)); test("f40c", () => [run_f40(5), run_f40(1)]);
function run_f41(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f41(k, s); k++; } return s; }
function poke_f41() { said.push(1);  }
const c_f41 = (() => { const on = N * 0.5; const two = num(on) + 1; return (k, s) => { try { if (on) throw k; s += 1; } catch (e) { s += e; } return s + two; }; })();
test("f41", () => run_f41(6)); test("f41b", () => run_f41(0)); test("f41c", () => [run_f41(5), run_f41(1)]);
function run_f42(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f42(x, s); } return s; }
function poke_f42() { said.push(1); if (set_f42) set_f42(7); }
let set_f42; const c_f42 = (() => { let on = N * 0.5; set_f42 = x => { on = x; }; return (k, s) => { if (k === 4) other(on); s++; return s; }; })();
test("f42", () => run_f42(6)); test("f42b", () => run_f42(0)); test("f42c", () => [run_f42(5), run_f42(1)]);
function* gen_f43(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f43(k, s); yield s; } }
function run_f43(n) { let t = 0; for (const v of gen_f43(n)) t = mix(t, num(v)); return t; }
function poke_f43() { said.push(1);  }
const c_f43 = (() => { const on = N * 0.5; const two = num(on) + 1; return (k, s) => { if (on === undefined) return s; s += 2; return s + two; }; })();
test("f43", () => run_f43(6)); test("f43b", () => run_f43(0)); test("f43c", () => [run_f43(5), run_f43(1)]);
function run_f44(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f44(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f44() { said.push(1);  }
test("f44e", () => run_f44(3)); test("f44z", () => run_f44(0));
const c_f44 = (() => { const on = -0; const two = num(on) + 1; return (k, s) => { if (on && k > 2) say(k); return s + two; }; })();
test("f44", () => run_f44(6)); test("f44b", () => run_f44(0)); test("f44c", () => [run_f44(5), run_f44(1)]);
function run_f45(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f45(k, s); if (k === 3) poke_f45(); } return s; }
function poke_f45() { said.push(1);  }
function make_f45(name) { const on = Symbol.for('q' + N); return (k, s) => { if (on === undefined) return s; s += 2; return s; }; }
const c_f45 = make_f45("a");
test("f45", () => run_f45(6)); test("f45b", () => run_f45(0)); test("f45c", () => [run_f45(5), run_f45(1)]);
function run_f46(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f46(k, s); k++; } return s; }
function poke_f46() { said.push(1);  }
test("f46e", () => run_f46(3)); test("f46z", () => run_f46(0));
function make_f46(name) { const on = undefined; let count = 0; return (k, s) => { count++; s += num(on); return s + count; }; }
const c_f46 = make_f46("a");
test("f46", () => run_f46(6)); test("f46b", () => run_f46(0)); test("f46c", () => [run_f46(5), run_f46(1)]);
function run_f47(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f47(k, s) & 0xffffff; return s; }
function poke_f47() { said.push(1);  }
test("f47e", () => run_f47(3)); test("f47z", () => run_f47(0));
function make_f47(on) { return (k, s) => { s = mix(s, num(on) + k); return s; }; }
const c_f47 = make_f47(null);
test("f47", () => run_f47(6)); test("f47b", () => run_f47(0)); test("f47c", () => [run_f47(5), run_f47(1)]);
function run_f48(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f48(k, s); if (k === 3) poke_f48(); } return s; }
function poke_f48() { said.push(1);  }
function make_f48() { const on = (z) => z + N; const inner = (k, s) => { if (!on) s += 1; return s; }; return (k, s) => inner(k, s); }
const c_f48 = make_f48();
test("f48", () => run_f48(6)); test("f48b", () => run_f48(0)); test("f48c", () => [run_f48(5), run_f48(1)]);
function run_f49(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f49(x, s); } return s; }
function poke_f49() { said.push(1);  }
function make_f49(name) { const on = N > 50; let count = 0; return (k, s) => { count++; if (on) s += 100; return s + count; }; }
const c_f49 = make_f49("a");
test("f49", () => run_f49(6)); test("f49b", () => run_f49(0)); test("f49c", () => [run_f49(5), run_f49(1)]);
function run_f50(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f50(k, s); if (k === 3) poke_f50(); } return s; }
function poke_f50() { said.push(1);  }
const c_f50 = (() => { const on = N * 0.5; const two = num(on) + 1; return (k, s) => { switch (typeof on) { case 'number': s += 1; break; case 'string': s += 2; break; default: s += 3; } return s + two; }; })();
test("f50", () => run_f50(6)); test("f50b", () => run_f50(0)); test("f50c", () => [run_f50(5), run_f50(1)]);
function* gen_f51(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f51(k, s); yield s; } }
function run_f51(n) { let t = 0; for (const v of gen_f51(n)) t = mix(t, num(v)); return t; }
function poke_f51() { said.push(1);  }
test("f51e", () => run_f51(3)); test("f51z", () => run_f51(0));
function make_f51(on) { return (k, s) => { if (on) s += 100; return s; }; }
let c_f51 = make_f51(N * 0.5); if (N > 70) c_f51 = make_f51(0);
test("f51", () => run_f51(6)); test("f51b", () => run_f51(0)); test("f51c", () => [run_f51(5), run_f51(1)]);
function run_f52(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f52(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f52() { said.push(1);  }
test("f52e", () => run_f52(3)); test("f52z", () => run_f52(0));
function make_f52(on) { return (k, s) => { if (!on) s += 1; return s; }; }
let c_f52 = make_f52('t' + N); if (N > 70) c_f52 = make_f52(0);
test("f52", () => run_f52(6)); test("f52b", () => run_f52(0)); test("f52c", () => [run_f52(5), run_f52(1)]);
function run_f53(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f53(x, s); } return s; }
function poke_f53() { said.push(1);  }
test("f53e", () => run_f53(3)); test("f53z", () => run_f53(0));
function make_f53(on) { return (k, s) => { if (on) s += 100; return s; }; }
let c_f53 = make_f53(N > 50 ? 1 : undefined); if (N > 70) c_f53 = make_f53(0);
test("f53", () => run_f53(6)); test("f53b", () => run_f53(0)); test("f53c", () => [run_f53(5), run_f53(1)]);
function* gen_f54(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f54(k, s); yield s; } }
function run_f54(n) { let t = 0; for (const v of gen_f54(n)) t = mix(t, num(v)); return t; }
function poke_f54() { said.push(1);  }
function make_f54(name) { const on = N < 50; let count = 0; return (k, s) => { count++; s += on ? k : -k; return s + count; }; }
const c_f54 = make_f54("a");
test("f54", () => run_f54(6)); test("f54b", () => run_f54(0)); test("f54c", () => [run_f54(5), run_f54(1)]);
function run_f55(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f55(k, s); if (k === 3) poke_f55(); } return s; }
function poke_f55() { said.push(1);  }
const c_f55 = (() => { const on = [N, 2]; const two = num(on) + 1; return (k, s) => { if (k === 4) other(on); s++; return s + two; }; })();
test("f55", () => run_f55(6)); test("f55b", () => run_f55(0)); test("f55c", () => [run_f55(5), run_f55(1)]);
function run_f56(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f56(k, s) & 0xffffff; return s; }
function poke_f56() { said.push(1);  }
test("f56e", () => run_f56(3)); test("f56z", () => run_f56(0));
function make_f56(on) { return (k, s) => { if (!on) s += 1; return s; }; }
let c_f56 = make_f56(-0); if (N > 70) c_f56 = make_f56(0);
test("f56", () => run_f56(6)); test("f56b", () => run_f56(0)); test("f56c", () => [run_f56(5), run_f56(1)]);
function run_f57(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f57(k, s); return s; }
function poke_f57() { said.push(1);  }
test("f57e", () => run_f57(3)); test("f57z", () => run_f57(0));
class H_f57 { static on = N + 3; static c = (() => { const on = H_f57.on; return (k, s) => { s += on?.v ?? 1; return s; }; })(); }
const c_f57 = H_f57.c;
test("f57", () => run_f57(6)); test("f57b", () => run_f57(0)); test("f57c", () => [run_f57(5), run_f57(1)]);
function run_f58(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f58(k, s) & 0xffffff; return s; }
function poke_f58() { said.push(1);  }
function make_f58() { const on = null; const inner = (k, s) => { s += num(on); return s; }; return (k, s) => inner(k, s); }
const c_f58 = make_f58();
test("f58", () => run_f58(6)); test("f58b", () => run_f58(0)); test("f58c", () => [run_f58(5), run_f58(1)]);
function run_f59(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f59(x, s); }); return s; }
function poke_f59() { said.push(1); if (set_f59) set_f59(7); }
let set_f59; const c_f59 = (() => { let on = { v: N }; set_f59 = x => { on = x; }; return (k, s) => { s += num(on); return s; }; })();
test("f59", () => run_f59(6)); test("f59b", () => run_f59(0)); test("f59c", () => [run_f59(5), run_f59(1)]);
function run_f60(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f60(k, s) & 0xffffff; return s; }
function poke_f60() { said.push(1);  }
function make_f60(name) { const on = NaN; return (k, s) => { for (let j = 0; j < 3; j++) s += num(on) + j; return s; }; }
const c_f60 = make_f60("a");
test("f60", () => run_f60(6)); test("f60b", () => run_f60(0)); test("f60c", () => [run_f60(5), run_f60(1)]);
function* gen_f61(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f61(k, s); yield s; } }
function run_f61(n) { let t = 0; for (const v of gen_f61(n)) t = mix(t, num(v)); return t; }
function poke_f61() { said.push(1); if (set_f61) set_f61(7); }
test("f61e", () => run_f61(3)); test("f61z", () => run_f61(0));
let set_f61; const c_f61 = (() => { let on = (z) => z + N; set_f61 = x => { on = x; }; return (k, s) => { if (k === 4) other(on); s++; return s; }; })();
test("f61", () => run_f61(6)); test("f61b", () => run_f61(0)); test("f61c", () => [run_f61(5), run_f61(1)]);
function run_f62(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f62(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f62() { said.push(1);  }
test("f62e", () => run_f62(3)); test("f62z", () => run_f62(0));
function make_f62(name) { const on = N > 50 ? 1 : undefined; let count = 0; return (k, s) => { count++; if (on && k > 2) say(k); return s + count; }; }
const c_f62 = make_f62("a");
test("f62", () => run_f62(6)); test("f62b", () => run_f62(0)); test("f62c", () => [run_f62(5), run_f62(1)]);
function run_f63(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f63(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f63() { said.push(1);  }
function make_f63(name) { const on = N + 3; let count = 0; return (k, s) => { count++; for (let j = 0; j < 3; j++) s += num(on) + j; return s + count; }; }
const c_f63 = make_f63("a");
test("f63", () => run_f63(6)); test("f63b", () => run_f63(0)); test("f63c", () => [run_f63(5), run_f63(1)]);
function run_f64(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f64(x, s); } return s; }
function poke_f64() { said.push(1);  }
function make_f64(on) { return (k, s) => { if (on && k > 2) say(k); return s; }; }
let c_f64 = make_f64((z) => z + N); if (N > 70) c_f64 = make_f64(0);
test("f64", () => run_f64(6)); test("f64b", () => run_f64(0)); test("f64c", () => [run_f64(5), run_f64(1)]);
function run_f65(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f65(k, s); if (k === 3) poke_f65(); } return s; }
function poke_f65() { said.push(1); if (set_f65) set_f65(7); }
let set_f65; const c_f65 = (() => { let on = { v: N }; set_f65 = x => { on = x; }; return (k, s) => { s += list.filter(x => x > num(on)).length; return s; }; })();
test("f65", () => run_f65(6)); test("f65b", () => run_f65(0)); test("f65c", () => [run_f65(5), run_f65(1)]);
function run_f66(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f66(k, s) & 0xffffff; return s; }
function poke_f66() { said.push(1);  }
const c_f66 = (function () { const on = maybe(N); function inner(k, s) { s += num(on); return s; } return inner; })();
test("f66", () => run_f66(6)); test("f66b", () => run_f66(0)); test("f66c", () => [run_f66(5), run_f66(1)]);
function run_f67(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f67(x, s); } return s; }
function poke_f67() { said.push(1);  }
const c_f67 = (function () { const on = null; function inner(k, s) { s += num(on); return s; } return inner; })();
test("f67", () => run_f67(6)); test("f67b", () => run_f67(0)); test("f67c", () => [run_f67(5), run_f67(1)]);
function* gen_f68(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f68(k, s); yield s; } }
function run_f68(n) { let t = 0; for (const v of gen_f68(n)) t = mix(t, num(v)); return t; }
function poke_f68() { said.push(1);  }
class H_f68 { static on = N * 0.5; static c = (() => { const on = H_f68.on; return (k, s) => { if (on) s += 100; return s; }; })(); }
const c_f68 = H_f68.c;
test("f68", () => run_f68(6)); test("f68b", () => run_f68(0)); test("f68c", () => [run_f68(5), run_f68(1)]);
function run_f69(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f69(k, s); k++; } return s; }
function poke_f69() { said.push(1);  }
test("f69e", () => run_f69(3)); test("f69z", () => run_f69(0));
function make_f69(on) { return (k, s) => { if (on === undefined) return s; s += 2; return s; }; }
const c_f69 = make_f69(maybe(N));
test("f69", () => run_f69(6)); test("f69b", () => run_f69(0)); test("f69c", () => [run_f69(5), run_f69(1)]);
function run_f70(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f70(k, s); return s; }
function poke_f70() { said.push(1); if (set_f70) set_f70(7); }
let set_f70; const c_f70 = (() => { let on = (z) => z + N; set_f70 = x => { on = x; }; return (k, s) => { s = mix(s, num(on) + k); return s; }; })();
test("f70", () => run_f70(6)); test("f70b", () => run_f70(0)); test("f70c", () => [run_f70(5), run_f70(1)]);
function* gen_f71(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f71(k, s); yield s; } }
function run_f71(n) { let t = 0; for (const v of gen_f71(n)) t = mix(t, num(v)); return t; }
function poke_f71() { said.push(1);  }
function make_f71(on) { return (k, s) => { return s + num(on); return s; }; }
let c_f71 = make_f71(null); if (N > 70) c_f71 = make_f71(0);
test("f71", () => run_f71(6)); test("f71b", () => run_f71(0)); test("f71c", () => [run_f71(5), run_f71(1)]);
function run_f72(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f72(x, s); }); return s; }
function poke_f72() { said.push(1);  }
test("f72e", () => run_f72(3)); test("f72z", () => run_f72(0));
class H_f72 { static on = Symbol.for('q' + N); static c = (() => { const on = H_f72.on; return (k, s) => { if (!on) s += 1; return s; }; })(); }
const c_f72 = H_f72.c;
test("f72", () => run_f72(6)); test("f72b", () => run_f72(0)); test("f72c", () => [run_f72(5), run_f72(1)]);
function run_f73(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f73(k, s); return s; }
function poke_f73() { said.push(1);  }
function make_f73() { const on = -0; const inner = (k, s) => { if (on) s += 100; return s; }; return (k, s) => inner(k, s); }
const c_f73 = make_f73();
test("f73", () => run_f73(6)); test("f73b", () => run_f73(0)); test("f73c", () => [run_f73(5), run_f73(1)]);
function run_f74(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f74(x, s); }); return s; }
function poke_f74() { said.push(1);  }
function make_f74(on) { return (k, s) => { s += on?.v ?? 1; return s; }; }
let c_f74 = make_f74(N > 50 ? 1 : undefined); if (N > 70) c_f74 = make_f74(0);
test("f74", () => run_f74(6)); test("f74b", () => run_f74(0)); test("f74c", () => [run_f74(5), run_f74(1)]);
function* gen_f75(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f75(k, s); yield s; } }
function run_f75(n) { let t = 0; for (const v of gen_f75(n)) t = mix(t, num(v)); return t; }
function poke_f75() { said.push(1); if (set_f75) set_f75(7); }
test("f75e", () => run_f75(3)); test("f75z", () => run_f75(0));
let set_f75; const c_f75 = (() => { let on = BigInt(N); set_f75 = x => { on = x; }; return (k, s) => { s += on?.v ?? 1; return s; }; })();
test("f75", () => run_f75(6)); test("f75b", () => run_f75(0)); test("f75c", () => [run_f75(5), run_f75(1)]);
function run_f76(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f76(k, s); return s; }
function poke_f76() { said.push(1);  }
test("f76e", () => run_f76(3)); test("f76z", () => run_f76(0));
function make_f76(on) { return { call(k, s) { if (!on) s += 1; return s; } }; }
const o_f76 = make_f76(-0); const c_f76 = (k, s) => o_f76.call(k, s);
test("f76", () => run_f76(6)); test("f76b", () => run_f76(0)); test("f76c", () => [run_f76(5), run_f76(1)]);
function run_f77(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f77(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f77() { said.push(1);  }
class H_f77 { static on = NaN; static c = (() => { const on = H_f77.on; return (k, s) => { s += num(on); return s; }; })(); }
const c_f77 = H_f77.c;
test("f77", () => run_f77(6)); test("f77b", () => run_f77(0)); test("f77c", () => [run_f77(5), run_f77(1)]);
function run_f78(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f78(k, s); if (k === 3) poke_f78(); } return s; }
function poke_f78() { said.push(1);  }
function make_f78() { const on = maybe(N); const inner = (k, s) => { if (on) s += 100; return s; }; return (k, s) => inner(k, s); }
const c_f78 = make_f78();
test("f78", () => run_f78(6)); test("f78b", () => run_f78(0)); test("f78c", () => [run_f78(5), run_f78(1)]);
function run_f79(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f79(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f79() { said.push(1);  }
function make_f79(on) { return { call(k, s) { if (on && k > 2) say(k); return s; } }; }
const o_f79 = make_f79(undefined); const c_f79 = (k, s) => o_f79.call(k, s);
test("f79", () => run_f79(6)); test("f79b", () => run_f79(0)); test("f79c", () => [run_f79(5), run_f79(1)]);
function run_f80(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f80(k, s); if (k === 3) poke_f80(); } return s; }
function poke_f80() { said.push(1);  }
test("f80e", () => run_f80(3)); test("f80z", () => run_f80(0));
function make_f80(name) { const on = N * 0.5; return (k, s) => { if (k === 4) other(on); s++; return s; }; }
const c_f80 = make_f80("a");
test("f80", () => run_f80(6)); test("f80b", () => run_f80(0)); test("f80c", () => [run_f80(5), run_f80(1)]);
function run_f81(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f81(x, s); } return s; }
function poke_f81() { said.push(1);  }
function make_f81(on) { return { call(k, s) { if (on && k > 2) say(k); return s; } }; }
const o_f81 = make_f81(new Map([[1, N]])); const c_f81 = (k, s) => o_f81.call(k, s);
test("f81", () => run_f81(6)); test("f81b", () => run_f81(0)); test("f81c", () => [run_f81(5), run_f81(1)]);
function run_f82(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f82(k, s); k++; } return s; }
function poke_f82() { said.push(1);  }
function make_f82(name) { const on = Symbol.for('q' + N); let count = 0; return (k, s) => { count++; for (let j = 0; j < 3; j++) s += num(on) + j; return s + count; }; }
const c_f82 = make_f82("a");
test("f82", () => run_f82(6)); test("f82b", () => run_f82(0)); test("f82c", () => [run_f82(5), run_f82(1)]);
function run_f83(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f83(x, s); } return s; }
function poke_f83() { said.push(1);  }
function make_f83(name) { const on = Symbol.for('q' + N); let count = 0; return (k, s) => { count++; if (on && k > 2) say(k); return s + count; }; }
const c_f83 = make_f83("a");
test("f83", () => run_f83(6)); test("f83b", () => run_f83(0)); test("f83c", () => [run_f83(5), run_f83(1)]);
function run_f84(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f84(k, s); if (k === 3) poke_f84(); } return s; }
function poke_f84() { said.push(1);  }
test("f84e", () => run_f84(3)); test("f84z", () => run_f84(0));
function make_f84() { const on = N > 50 ? 1 : undefined; const inner = (k, s) => { try { if (on) throw k; s += 1; } catch (e) { s += e; } return s; }; return (k, s) => inner(k, s); }
const c_f84 = make_f84();
test("f84", () => run_f84(6)); test("f84b", () => run_f84(0)); test("f84c", () => [run_f84(5), run_f84(1)]);
function run_f85(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f85(k, s); return s; }
function poke_f85() { said.push(1);  }
test("f85e", () => run_f85(3)); test("f85z", () => run_f85(0));
function make_f85(on) { return { call(k, s) { return s + num(on); return s; } }; }
const o_f85 = make_f85(BigInt(N)); const c_f85 = (k, s) => o_f85.call(k, s);
test("f85", () => run_f85(6)); test("f85b", () => run_f85(0)); test("f85c", () => [run_f85(5), run_f85(1)]);
function run_f86(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f86(k, s); if (k === 3) poke_f86(); } return s; }
function poke_f86() { said.push(1);  }
function make_f86(on) { return (k, s) => { return s + num(on); return s; }; }
const c_f86 = make_f86([N, 2]);
test("f86", () => run_f86(6)); test("f86b", () => run_f86(0)); test("f86c", () => [run_f86(5), run_f86(1)]);
function run_f87(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f87(x, s); }); return s; }
function poke_f87() { said.push(1);  }
test("f87e", () => run_f87(3)); test("f87z", () => run_f87(0));
function make_f87(on) { return (k, s) => { switch (typeof on) { case 'number': s += 1; break; case 'string': s += 2; break; default: s += 3; } return s; }; }
const c_f87 = make_f87(null);
test("f87", () => run_f87(6)); test("f87b", () => run_f87(0)); test("f87c", () => [run_f87(5), run_f87(1)]);
function run_f88(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f88(x, s); }); return s; }
function poke_f88() { said.push(1);  }
test("f88e", () => run_f88(3)); test("f88z", () => run_f88(0));
const c_f88 = (() => { const on = Symbol.for('q' + N); const two = num(on) + 1; return (k, s) => { if (on) s += 100; return s + two; }; })();
test("f88", () => run_f88(6)); test("f88b", () => run_f88(0)); test("f88c", () => [run_f88(5), run_f88(1)]);
function run_f89(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f89(k, s); if (k === 3) poke_f89(); } return s; }
function poke_f89() { said.push(1);  }
const c_f89 = (() => { const on = Symbol.for('q' + N); const two = num(on) + 1; return (k, s) => { s += on?.v ?? 1; return s + two; }; })();
test("f89", () => run_f89(6)); test("f89b", () => run_f89(0)); test("f89c", () => [run_f89(5), run_f89(1)]);
function run_f90(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f90(k, s); if (k === 3) poke_f90(); } return s; }
function poke_f90() { said.push(1);  }
test("f90e", () => run_f90(3)); test("f90z", () => run_f90(0));
const c_f90 = (() => { const on = N < 50; const two = num(on) + 1; return (k, s) => { if (k === 4) other(on); s++; return s + two; }; })();
test("f90", () => run_f90(6)); test("f90b", () => run_f90(0)); test("f90c", () => [run_f90(5), run_f90(1)]);
function run_f91(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f91(k, s); if (k === 3) poke_f91(); } return s; }
function poke_f91() { said.push(1);  }
function make_f91(name) { const on = (z) => z + N; return (k, s) => { if (!on) s += 1; return s; }; }
const c_f91 = make_f91("a");
test("f91", () => run_f91(6)); test("f91b", () => run_f91(0)); test("f91c", () => [run_f91(5), run_f91(1)]);
function run_f92(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f92(k, s); k++; } return s; }
function poke_f92() { said.push(1);  }
test("f92e", () => run_f92(3)); test("f92z", () => run_f92(0));
function make_f92(on) { return { call(k, s) { if (on && k > 2) say(k); return s; } }; }
const o_f92 = make_f92(N * 0.5); const c_f92 = (k, s) => o_f92.call(k, s);
test("f92", () => run_f92(6)); test("f92b", () => run_f92(0)); test("f92c", () => [run_f92(5), run_f92(1)]);
function run_f93(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f93(k, s) & 0xffffff; return s; }
function poke_f93() { said.push(1);  }
class H_f93 { static on = N + 3; static c = (() => { const on = H_f93.on; return (k, s) => { if (k === 4) other(on); s++; return s; }; })(); }
const c_f93 = H_f93.c;
test("f93", () => run_f93(6)); test("f93b", () => run_f93(0)); test("f93c", () => [run_f93(5), run_f93(1)]);
function* gen_f94(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f94(k, s); yield s; } }
function run_f94(n) { let t = 0; for (const v of gen_f94(n)) t = mix(t, num(v)); return t; }
function poke_f94() { said.push(1);  }
test("f94e", () => run_f94(3)); test("f94z", () => run_f94(0));
function make_f94(name) { const on = N > 50 ? 'a' : 2; return (k, s) => { return s + num(on); return s; }; }
const c_f94 = make_f94("a");
test("f94", () => run_f94(6)); test("f94b", () => run_f94(0)); test("f94c", () => [run_f94(5), run_f94(1)]);
function run_f95(n) { let s = 1; let k = 0; while (k < n) { if (k % 2) s = c_f95(k, s); k++; } return s; }
function poke_f95() { said.push(1);  }
test("f95e", () => run_f95(3)); test("f95z", () => run_f95(0));
const c_f95 = (function () { const on = { v: N }; function inner(k, s) { if (on && k > 2) say(k); return s; } return inner; })();
test("f95", () => run_f95(6)); test("f95b", () => run_f95(0)); test("f95c", () => [run_f95(5), run_f95(1)]);
function run_f96(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f96(k, s) & 0xffffff; return s; }
function poke_f96() { said.push(1);  }
class H_f96 { static on = new Map([[1, N]]); static c = (() => { const on = H_f96.on; return (k, s) => { if (on) s += 100; return s; }; })(); }
const c_f96 = H_f96.c;
test("f96", () => run_f96(6)); test("f96b", () => run_f96(0)); test("f96c", () => [run_f96(5), run_f96(1)]);
function run_f97(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f97(x, s); }); return s; }
function poke_f97() { said.push(1);  }
function make_f97(on) { return (k, s) => { s += on?.v ?? 1; return s; }; }
const c_f97 = make_f97(N + 3);
test("f97", () => run_f97(6)); test("f97b", () => run_f97(0)); test("f97c", () => [run_f97(5), run_f97(1)]);
function run_f98(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f98(k, s); return s; }
function poke_f98() { said.push(1);  }
test("f98e", () => run_f98(3)); test("f98z", () => run_f98(0));
function make_f98(name) { const on = { v: N }; return (k, s) => { if (on && k > 2) say(k); return s; }; }
const c_f98 = make_f98("a");
test("f98", () => run_f98(6)); test("f98b", () => run_f98(0)); test("f98c", () => [run_f98(5), run_f98(1)]);
function run_f99(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f99(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f99() { said.push(1);  }
const c_f99 = (function () { const on = N < 50; function inner(k, s) { s += on?.v ?? 1; return s; } return inner; })();
test("f99", () => run_f99(6)); test("f99b", () => run_f99(0)); test("f99c", () => [run_f99(5), run_f99(1)]);
function run_f100(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f100(x, s); }); return s; }
function poke_f100() { said.push(1);  }
test("f100e", () => run_f100(3)); test("f100z", () => run_f100(0));
class H_f100 { static on = undefined; static c = (() => { const on = H_f100.on; return (k, s) => { s += on?.v ?? 1; return s; }; })(); }
const c_f100 = H_f100.c;
test("f100", () => run_f100(6)); test("f100b", () => run_f100(0)); test("f100c", () => [run_f100(5), run_f100(1)]);
function run_f101(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f101(x, s); } return s; }
function poke_f101() { said.push(1);  }
function make_f101(name) { const on = N > 50; let count = 0; return (k, s) => { count++; if (k === 4) other(on); s++; return s + count; }; }
const c_f101 = make_f101("a");
test("f101", () => run_f101(6)); test("f101b", () => run_f101(0)); test("f101c", () => [run_f101(5), run_f101(1)]);
function run_f102(n) { let s = 1; list.forEach(x => { if (n > 0) s = c_f102(x, s); }); return s; }
function poke_f102() { said.push(1);  }
test("f102e", () => run_f102(3)); test("f102z", () => run_f102(0));
function make_f102(on) { return (k, s) => { if (on) s += 100; return s; }; }
const c_f102 = make_f102(new Map([[1, N]]));
test("f102", () => run_f102(6)); test("f102b", () => run_f102(0)); test("f102c", () => [run_f102(5), run_f102(1)]);
function run_f103(n) { let s = 1; for (let k = 0; k < n; k++) s = c_f103(k, s); return s; }
function poke_f103() { said.push(1);  }
class H_f103 { static on = [N, 2]; static c = (() => { const on = H_f103.on; return (k, s) => { s += on?.v ?? 1; return s; }; })(); }
const c_f103 = H_f103.c;
test("f103", () => run_f103(6)); test("f103b", () => run_f103(0)); test("f103c", () => [run_f103(5), run_f103(1)]);
function run_f104(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f104(k, s) & 0xffffff; return s; }
function poke_f104() { said.push(1);  }
test("f104e", () => run_f104(3)); test("f104z", () => run_f104(0));
function make_f104() { const on = N + 3; const inner = (k, s) => { s += num(on); return s; }; return (k, s) => inner(k, s); }
const c_f104 = make_f104();
test("f104", () => run_f104(6)); test("f104b", () => run_f104(0)); test("f104c", () => [run_f104(5), run_f104(1)]);
function run_f105(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f105(k, s); if (k === 3) poke_f105(); } return s; }
function poke_f105() { said.push(1);  }
function make_f105(name) { const on = 't' + N; return (k, s) => { if (on) s += 100; return s; }; }
const c_f105 = make_f105("a");
test("f105", () => run_f105(6)); test("f105b", () => run_f105(0)); test("f105c", () => [run_f105(5), run_f105(1)]);
function* gen_f106(n) { let s = 1; for (let k = 0; k < n; k++) { s = c_f106(k, s); yield s; } }
function run_f106(n) { let t = 0; for (const v of gen_f106(n)) t = mix(t, num(v)); return t; }
function poke_f106() { said.push(1);  }
class H_f106 { static on = N * 0.5; static c = (() => { const on = H_f106.on; return (k, s) => { switch (typeof on) { case 'number': s += 1; break; case 'string': s += 2; break; default: s += 3; } return s; }; })(); }
const c_f106 = H_f106.c;
test("f106", () => run_f106(6)); test("f106b", () => run_f106(0)); test("f106c", () => [run_f106(5), run_f106(1)]);
function run_f107(n) { let s = 1; try { for (let k = 0; k < n; k++) s = c_f107(k, s); } catch (e) { s = "!" + e.constructor.name; } return s; }
function poke_f107() { said.push(1);  }
function make_f107(name) { const on = N > 50 ? 'a' : 2; return (k, s) => { return s + num(on); return s; }; }
const c_f107 = make_f107("a");
test("f107", () => run_f107(6)); test("f107b", () => run_f107(0)); test("f107c", () => [run_f107(5), run_f107(1)]);
function run_f108(n) { let s = 1; for (const x of list) { if (n === 0) break; s = c_f108(x, s); } return s; }
function poke_f108() { said.push(1);  }
class H_f108 { static on = BigInt(N); static c = (() => { const on = H_f108.on; return (k, s) => { for (let j = 0; j < 3; j++) s += num(on) + j; return s; }; })(); }
const c_f108 = H_f108.c;
test("f108", () => run_f108(6)); test("f108b", () => run_f108(0)); test("f108c", () => [run_f108(5), run_f108(1)]);
function run_f109(n) { let s = 1; for (let r = 0; r < n; r++) for (let k = 0; k < 4; k++) s = c_f109(k, s) & 0xffffff; return s; }
function poke_f109() { said.push(1);  }
test("f109e", () => run_f109(3)); test("f109z", () => run_f109(0));
function make_f109(on) { return { call(k, s) { return s + num(on); return s; } }; }
const o_f109 = make_f109(Symbol.for('q' + N)); const c_f109 = (k, s) => o_f109.call(k, s);
test("f109", () => run_f109(6)); test("f109b", () => run_f109(0)); test("f109c", () => [run_f109(5), run_f109(1)]);
console.log(total);
export {};
