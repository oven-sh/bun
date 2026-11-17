// Chains of filter and map with reduce, length or a list as their end, over lists, elements and callbacks that show in which order the callbacks run.
const said = []; class Item { v; w; on; name; constructor(k) { this.v = k; this.w = k * 2; this.on = k > 1; this.name = "i" + k; } } class Other extends Array {}
function spy(n) { return { get v() { said.push("v" + n); return n; }, get w() { said.push("w" + n); return n; }, get on() { said.push("on" + n); return true; }, get name() { said.push("name" + n); return "n" + n; }, get length() { said.push("length" + n); return n; }, valueOf() { said.push("value" + n); return n; } }; }
function counted(n) { return { v: n, w: n, on: true, name: "c", valueOf() { said.push("of" + n); return n; } }; }
function isOdd(x) { return x & 1; } function twice(x) { return x * 2; } function add(a, b) { return a + b; } function seen(x) { said.push("seen"); return x; }
function mix(h, v) { return typeof v === "number" ? (Math.imul(h, 33) + (v | 0)) | 0 : h + String(v); }
function str(l) { return Array.isArray(l) + ":" + l.length + ":" + l.map((x) => typeof x === "object" && x ? x.v : typeof x === "symbol" ? "s" : String(x)).join("/") + ":" + Object.getOwnPropertyNames(l).length + (Object.getPrototypeOf(l) === Array.prototype); } function pushed(l) { l.push(3); l[l.length] = 0.5; l.unshift("u"); return l.length + ":" + typeof l[1] + l[l.length - 2] + Object.isFrozen(l); } function walked(l) { let t = 0; for (const x of l) t = mix(t, typeof x === "number" ? x : 1); l.length = 0; return t; }
function proxied(l) { return new Proxy(l, { get(t, k, r) { said.push("p" + String(k)); return Reflect.get(t, k, r); } }); } function like(l) { return Object.assign(new Other(), l); }
let total = 0; function test(name, f) { const all = []; for (let i = 0; i < 7; i++) { let a; try { a = f(i); a = Object.is(a, -0) ? "-0" : String(a); } catch (e) { a = "!" + e.constructor.name + ":" + String(e.message).length % 1; } all.push(a + (said.length ? "[" + said.join() + "]" : "")); said.length = 0; } console.log(name, all.join(" ")); total++; }
const xs_h0 = [3];
function inner_h0(xs, i) { const lim = i & 3; let count = 0; return walked((i === 5 ? null : xs).map(x => x / 2)); }
function run_h0(i) { const xs = xs_h0; if (i === 4) { xs[1] = null; } return inner_h0(xs, i); }
test("h0 nums nullish", run_h0);
const xs_h1 = [3];
function run_h1(i) { const xs = xs_h1; const lim = i & 3; let count = 0; if (i === 4) { xs.map = function (f) { said.push('own map'); return Array.prototype.map.call(this, f); }; } try { return walked(xs.filter(x => { delete xs[3]; return true; })); } catch (e) { return "caught " + e.constructor.name; } }
test("h1 nums own", run_h1);
const xs_h2 = ['a', 'bb', '', 'dddd', 'e'];
function run_h2(i) { const xs = xs_h2; const lim = i & 3; let count = 0; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } try { return xs.filter(t => t).map(t => t.length).reduce((a, b) => a < b ? b : a, 1); } catch (e) { return "caught " + e.constructor.name; } }
test("h2 texts longer", run_h2);
const xs_h3 = ['a', 'bb', '', 'dddd', 'e'];
function* gen_h3(i) { const xs = xs_h3; const lim = i & 3; let count = 0; if (i === 4) { xs.length = 1; } yield Object.keys(xs.filter(t => t.length > 1)).length; }
function run_h3(i) { return gen_h3(i).next().value; }
test("h3 texts shorter", run_h3);
const xs_h4 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function inner_h4(xs, i) { const lim = i & 3; let count = 0; return xs.map(x => { count++; return count; }).length + xs.map(x => { count++; return count; }).reduce((a, b) => a * 3 + b, 1); }
function run_h4(i) { const xs = xs_h4; if (i === 4) { xs.constructor = Other; } return inner_h4(xs, i); }
test("h4 nums constructor", run_h4);
class K_h5 { xs = [{ v: 1, w: 2, on: true, name: 'a' }]; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 'x3'; } return (i === 5 ? null : xs).map(r => r.on && r.name).filter(Boolean)[0]; } }
const k_h5 = new K_h5();
function run_h5(i) { return k_h5.run(i); }
test("h5 rows text", run_h5);
const xs_h6 = [1, 2, 2147483647, -5, 1e10];
function inner_h6(xs, i) { const lim = i & 3; let count = 0; return xs.map(x => x | 0).map(x => x > 3 ? x : 0).length + xs.map(x => x | 0).map(x => x > 3 ? x : 0).reduce((a, b) => b, -0); }
function run_h6(i) { const xs = xs_h6; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } return inner_h6(xs, i); }
test("h6 nums longer", run_h6);
class K_h7 { xs = []; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = null; } return (i === 5 ? proxied(xs) : xs).filter(x => x < lim).map(x => x).filter(x => x == 2).length + (i === 5 ? proxied(xs) : xs).filter(x => x < lim).map(x => x).filter(x => x == 2).reduce((a, b) => a - b * 2, ''); } }
const k_h7 = new K_h7();
function run_h7(i) { return k_h7.run(i); }
test("h7 nums nullish", run_h7);
const xs_h8 = [];
function* gen_h8(i) { const xs = xs_h8; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = spy(1); xs[2] = spy(2); } yield (i === 5 ? null : xs).filter(x => x % 3 === i % 3).map(x => -x).filter(x => (x & 1) === 0)[0]; }
function run_h8(i) { return gen_h8(i).next().value; }
test("h8 nums getter", run_h8);
const xs_h9 = Array.from({ length: 5 }, (_, k) => new Item(k));
function run_h9(i) { const xs = xs_h9; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = null; } try { return (i === 5 ? like(xs) : xs).filter(r => r.w < lim).reduce((a, r) => a + r.w * 2, lim); } catch (e) { return "caught " + e.constructor.name; } }
test("h9 rows nullish", run_h9);
const xs_h10 = Array.from({ length: 12 }, (_, k) => k * 1.5);
function* gen_h10(i) { const xs = xs_h10; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = spy(1); xs[2] = spy(2); } yield (i === 5 ? proxied(xs) : xs).filter(x => x % 3 === i % 3).length + (i === 5 ? proxied(xs) : xs).filter(x => x % 3 === i % 3).reduce((a, b) => a * 3 + b, i); }
function run_h10(i) { return gen_h10(i).next().value; }
test("h10 nums getter", run_h10);
class K_h11 { xs = Array.from({ length: 5 }, (_, k) => new Item(k)); lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs.filter = function (f) { said.push('own filter'); return Array.prototype.filter.call(this, f); }; } return xs.map(r => r.v).map(x => x)[0]; } }
const k_h11 = new K_h11();
function run_h11(i) { return k_h11.run(i); }
test("h11 rows ownFilter", run_h11);
const xs_h12 = [1, 2, 2147483647, -5, 1e10];
function* gen_h12(i) { const xs = xs_h12; const lim = i & 3; let count = 0; if (i === 4) { Object.defineProperty(xs, 1, { get() { said.push('index'); return 3; }, configurable: true, enumerable: true }); } yield (i === 5 ? like(xs) : xs).filter(x => { if (count++ > 5) throw new Error('k'); return x; }).map(x => x | 0).reduce((a, b) => a > b ? a : b, i); }
function run_h12(i) { return gen_h12(i).next().value; }
test("h12 nums indexGetter", run_h12);
const xs_h13 = Array.from({ length: 9 }, (_, k) => (k * 7) % 5);
function inner_h13(xs, i) { const lim = i & 3; let count = 0; return xs.map(x => { xs[1] = xs[0]; return 2; }).filter(x => x < lim).reduce((a, b) => a > b ? a : b, 1); }
function run_h13(i) { const xs = xs_h13; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } return inner_h13(xs, i); }
test("h13 nums longer", run_h13);
function run_h14(i) { const xs = [1, 2, 2147483647, -5, 1e10]; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 5n; } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, str((i === 5 ? like(xs) : xs).filter(x => (x & 1) === 0).map(x => x))); return t; }
test("h14 nums big", run_h14);
class K_h15 { xs = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4]; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { Object.defineProperty(xs, 1, { get() { said.push('index'); return 3; }, configurable: true, enumerable: true }); } return str((i === 5 ? proxied(xs) : xs).filter(x => { delete xs[3]; return true; }).map(x => x / 2).filter(x => x % 3 === i % 3)); } }
const k_h15 = new K_h15();
function run_h15(i) { return k_h15.run(i); }
test("h15 nums indexGetter", run_h15);
const xs_h16 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function run_h16(i) { const xs = xs_h16; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 5n; } try { return xs.map(x => x > 3 ? x : 0).map(x => x > 3 ? x : 0)[0]; } catch (e) { return "caught " + e.constructor.name; } }
test("h16 nums big", run_h16);
const xs_h17 = ['a', 'bb', '', 'dddd', 'e'];
function* gen_h17(i) { const xs = xs_h17; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = null; } yield (i === 5 ? null : xs).filter(t => t !== '').filter(t => t.length > 1).length; }
function run_h17(i) { return gen_h17(i).next().value; }
test("h17 texts nullish", run_h17);
const xs_h18 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function run_h18(i) { const xs = xs_h18; const lim = i & 3; let count = 0; if (i === 4) { xs.map = function (f) { said.push('own map'); return Array.prototype.map.call(this, f); }; } try { return (i === 5 ? null : xs).map(x => x > 3 ? x : 0).filter(x => x * 2 > lim)[0]; } catch (e) { return "caught " + e.constructor.name; } }
test("h18 nums own", run_h18);
class K_h19 { xs = [3]; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = Symbol('s'); } return str(xs.filter(x => x % 3 === i % 3)); } }
const k_h19 = new K_h19();
function run_h19(i) { return k_h19.run(i); }
test("h19 nums symbol", run_h19);
const xs_h20 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function* gen_h20(i) { const xs = xs_h20; const lim = i & 3; let count = 0; if (i === 4) { delete xs[1]; } yield xs.map(x => x * x - 1).map(x => x + i).length + xs.map(x => x * x - 1).map(x => x + i).reduce((a, b) => { if (b === undefined) throw new RangeError('r'); return a; }, i); }
function run_h20(i) { return gen_h20(i).next().value; }
test("h20 nums hole", run_h20);
const xs_h21 = [];
function run_h21(i) { const xs = xs_h21; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = Symbol('s'); } try { return xs.filter(x => x * 2 > lim)[0]; } catch (e) { return "caught " + e.constructor.name; } }
test("h21 nums symbol", run_h21);
function run_h22(i) { const xs = [1, 2, 2147483647, -5, 1e10]; const lim = i & 3; let count = 0; if (i === 4) { xs.length = 1; } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, Object.keys((i === 5 ? proxied(xs) : xs).filter(x => x).map(x => x + i)).length); return t; }
test("h22 nums shorter", run_h22);
const xs_h23 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function* gen_h23(i) { const xs = xs_h23; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 5n; } yield (i === 5 ? like(xs) : xs).filter(x => x % 3 === i % 3).map(x => x + lim).filter(x => x > 2)[0]; }
function run_h23(i) { return gen_h23(i).next().value; }
test("h23 nums big", run_h23);
function run_h24(i) { const xs = [3]; const lim = i & 3; let count = 0; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, xs.filter(x => x % 3 === i % 3).map(x => x + i)[0]); return t; }
test("h24 nums longer", run_h24);
class K_h25 { xs = []; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = null; } return walked((i === 5 ? like(xs) : xs).filter(x => x - 1)); } }
const k_h25 = new K_h25();
function run_h25(i) { return k_h25.run(i); }
test("h25 nums nullish", run_h25);
function run_h26(i) { const xs = []; const lim = i & 3; let count = 0; if (i === 4) { xs[0] = NaN; } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, walked(xs.filter(x => !x).map(x => x * 2))); return t; }
test("h26 nums nan", run_h26);
const xs_h27 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function run_h27(i) { const xs = xs_h27; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 'x3'; } return xs.map(x => { xs[1] = xs[0]; return 2; }).filter(x => x % 3 === i % 3).length + xs.map(x => { xs[1] = xs[0]; return 2; }).filter(x => x % 3 === i % 3).reduce((a, b) => a - b * 2, lim); }
test("h27 nums text", run_h27);
const xs_h28 = [{ v: 1, w: 2, on: true, name: 'a' }];
function run_h28(i) { const xs = xs_h28; const lim = i & 3; let count = 0; if (i === 4) { delete xs[1]; } return xs.map(r => r.v * 2).filter(Boolean).length; }
test("h28 rows hole", run_h28);
const xs_h29 = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k }));
function run_h29(i) { const xs = xs_h29; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = spy(1); xs[2] = spy(2); } try { return Object.keys((i === 5 ? like(xs) : xs).map(r => r.on ? r.v : 0).filter(Boolean)).length; } catch (e) { return "caught " + e.constructor.name; } }
test("h29 rows getter", run_h29);
const xs_h30 = Array.from({ length: 9 }, (_, k) => (k * 7) % 5);
function* gen_h30(i) { const xs = xs_h30; const lim = i & 3; let count = 0; if (i === 4) { xs.map = function (f) { said.push('own map'); return Array.prototype.map.call(this, f); }; } yield walked(xs.map(x => x >>> 1).filter(x => !x)); }
function run_h30(i) { return gen_h30(i).next().value; }
test("h30 nums own", run_h30);
const xs_h31 = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k }));
function* gen_h31(i) { const xs = xs_h31; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 'x3'; } yield Object.keys((i === 5 ? like(xs) : xs).filter(r => r.v > 2)).length; }
function run_h31(i) { return gen_h31(i).next().value; }
test("h31 rows text", run_h31);
const xs_h32 = [{ v: 1, w: 2, on: true, name: 'a' }];
function* gen_h32(i) { const xs = xs_h32; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = null; } yield (i === 5 ? null : xs).map(r => r.v + lim).filter(x => x > lim ? x < 100 : true)[0]; }
function run_h32(i) { return gen_h32(i).next().value; }
test("h32 rows nullish", run_h32);
function run_h33(i) { const xs = [1, 2, 2147483647, -5, 1e10]; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = counted(4); xs[2] = counted(2); } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, (i === 5 ? null : xs).filter(x => x < lim).filter(x => x).reduce((a, b) => (a ^ b) | 0, 1)); return t; }
test("h33 nums valueOf", run_h33);
class K_h34 { xs = [1, 2, 2147483647, -5, 1e10]; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = spy(1); xs[2] = spy(2); } return xs.filter(x => x == 2).reduce((a, b, k) => a + k, 0); } }
const k_h34 = new K_h34();
function run_h34(i) { return k_h34.run(i); }
test("h34 nums getter", run_h34);
const xs_h35 = Array.from({ length: 12 }, (_, k) => k * 1.5);
function run_h35(i) { const xs = xs_h35; const lim = i & 3; let count = 0; if (i === 4) { xs[30] = xs[0]; } try { return str(xs.filter(x => !x)); } catch (e) { return "caught " + e.constructor.name; } }
test("h35 nums gap", run_h35);
class K_h36 { xs = [{ v: 1, w: 2, on: true, name: 'a' }]; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { Object.defineProperty(xs, 1, { get() { said.push('index'); return 3; }, configurable: true, enumerable: true }); } return pushed((i === 5 ? like(xs) : xs).map(r => r.v).map(x => x * x - 1)); } }
const k_h36 = new K_h36();
function run_h36(i) { return k_h36.run(i); }
test("h36 rows indexGetter", run_h36);
const xs_h37 = ['a', 'bb', '', 'dddd', 'e'];
function inner_h37(xs, i) { const lim = i & 3; let count = 0; return pushed(xs.filter(t => t !== '').map(t => t.length * lim).filter(x => x)); }
function run_h37(i) { const xs = xs_h37; if (i === 4) { xs[1] = 5n; } return inner_h37(xs, i); }
test("h37 texts big", run_h37);
const xs_h38 = Array.from({ length: 5 }, (_, k) => new Item(k));
function* gen_h38(i) { const xs = xs_h38; const lim = i & 3; let count = 0; if (i === 4) {  } yield pushed(xs.filter(x => { if (xs.length < 14) xs.push(xs[0]); return x; })); }
function run_h38(i) { return gen_h38(i).next().value; }
test("h38 rows none", run_h38);
const xs_h39 = Array.from({ length: 9 }, (_, k) => (k * 7) % 5);
function inner_h39(xs, i) { const lim = i & 3; let count = 0; return xs.filter(x => x == 2).map(x => x + lim).reduce((a, b) => a < b ? b : a, i); }
function run_h39(i) { const xs = xs_h39; if (i === 4) { xs[1] = 'x3'; } return inner_h39(xs, i); }
test("h39 nums text", run_h39);
function run_h40(i) { const xs = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k })); const lim = i & 3; let count = 0; if (i === 4) { xs[1] = spy(1); xs[2] = spy(2); } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, pushed((i === 5 ? null : xs).map(r => r.w).filter(Boolean))); return t; }
test("h40 rows getter", run_h40);
const xs_h41 = Array.from({ length: 9 }, (_, k) => (k * 7) % 5);
function run_h41(i) { const xs = xs_h41; const lim = i & 3; let count = 0; if (i === 4) { xs.filter = function (f) { said.push('own filter'); return Array.prototype.filter.call(this, f); }; } try { return xs.filter(x => xs[0] === x).map(x => x >>> 1).filter(x => x > lim ? x < 100 : true).length + xs.filter(x => xs[0] === x).map(x => x >>> 1).filter(x => x > lim ? x < 100 : true).reduce((a, b) => (a ^ b) | 0, lim); } catch (e) { return "caught " + e.constructor.name; } }
test("h41 nums ownFilter", run_h41);
function run_h42(i) { const xs = ['a', 'bb', '', 'dddd', 'e']; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 'x3'; } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, (i === 5 ? like(xs) : xs).map(t => t.length * lim).filter(x => (x & 1) === 0).reduce((a, b) => { xs.length = 1; return a; }, i)); return t; }
test("h42 texts text", run_h42);
const xs_h43 = Array.from({ length: 5 }, (_, k) => new Item(k));
function* gen_h43(i) { const xs = xs_h43; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = counted(4); xs[2] = counted(2); } yield xs.filter(r => r.on).filter(r => r.w < lim).length; }
function run_h43(i) { return gen_h43(i).next().value; }
test("h43 rows valueOf", run_h43);
const xs_h44 = [{ v: 1, w: 2, on: true, name: 'a' }];
function* gen_h44(i) { const xs = xs_h44; const lim = i & 3; let count = 0; if (i === 4) { xs.constructor = Other; } yield xs.map(r => r.on ? r.v : 0).filter(Boolean).length + xs.map(r => r.on ? r.v : 0).filter(Boolean).reduce((a, b) => (a ^ b) | 0, -0); }
function run_h44(i) { return gen_h44(i).next().value; }
test("h44 rows constructor", run_h44);
const xs_h45 = Array.from({ length: 9 }, (_, k) => (k * 7) % 5);
function* gen_h45(i) { const xs = xs_h45; const lim = i & 3; let count = 0; if (i === 4) { delete xs[1]; } yield (i === 5 ? like(xs) : xs).filter(x => x - 1).map(x => x + i).length; }
function run_h45(i) { return gen_h45(i).next().value; }
test("h45 nums hole", run_h45);
const xs_h46 = Array.from({ length: 9 }, (_, k) => (k * 7) % 5);
function inner_h46(xs, i) { const lim = i & 3; let count = 0; return (i === 5 ? like(xs) : xs).filter(x => x % 3 === i % 3).reduce((a, b) => a < b ? b : a, 0.5); }
function run_h46(i) { const xs = xs_h46; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } return inner_h46(xs, i); }
test("h46 nums longer", run_h46);
const xs_h47 = Array.from({ length: 5 }, (_, k) => new Item(k));
function run_h47(i) { const xs = xs_h47; const lim = i & 3; let count = 0; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } try { return xs.map(r => r.w).filter(Boolean)[0]; } catch (e) { return "caught " + e.constructor.name; } }
test("h47 rows longer", run_h47);
const xs_h48 = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k }));
function inner_h48(xs, i) { const lim = i & 3; let count = 0; return pushed((i === 5 ? proxied(xs) : xs).filter(r => r.w < lim)); }
function run_h48(i) { const xs = xs_h48; if (i === 4) {  } return inner_h48(xs, i); }
test("h48 rows none", run_h48);
function run_h49(i) { const xs = []; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = Symbol('s'); } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, (i === 5 ? like(xs) : xs).filter(x => x > lim ? x < 100 : true).map(x => x > 3 ? x : 0).length); return t; }
test("h49 nums symbol", run_h49);
function run_h50(i) { const xs = [1, 2, 2147483647, -5, 1e10]; const lim = i & 3; let count = 0; if (i === 4) { xs.filter = function (f) { said.push('own filter'); return Array.prototype.filter.call(this, f); }; } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, xs.map(x => x + lim)[0]); return t; }
test("h50 nums ownFilter", run_h50);
function run_h51(i) { const xs = [{ v: 1, w: 2, on: true, name: 'a' }]; const lim = i & 3; let count = 0; if (i === 4) { delete xs[1]; } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, pushed((i === 5 ? like(xs) : xs).map(r => r.w).filter(Boolean))); return t; }
test("h51 rows hole", run_h51);
const xs_h52 = [1, 2, 2147483647, -5, 1e10];
function inner_h52(xs, i) { const lim = i & 3; let count = 0; return (i === 5 ? null : xs).map(x => x + lim).length; }
function run_h52(i) { const xs = xs_h52; if (i === 4) { Object.freeze(xs); } return inner_h52(xs, i); }
test("h52 nums frozen", run_h52);
function run_h53(i) { const xs = []; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 'x3'; } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, (i === 5 ? like(xs) : xs).filter(x => x).map(x => x > 3 ? x : 0)[0]); return t; }
test("h53 nums text", run_h53);
class K_h54 { xs = [{ v: 1, w: 2, on: true, name: 'a' }]; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { Object.setPrototypeOf(xs, Other.prototype); } return (i === 5 ? null : xs).filter(r => r.v > 2).filter(r => r.v).length + (i === 5 ? null : xs).filter(r => r.v > 2).filter(r => r.v).reduce((a, r) => a > r.v ? a : r.v, i * 2); } }
const k_h54 = new K_h54();
function run_h54(i) { return k_h54.run(i); }
test("h54 rows proto", run_h54);
const xs_h55 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function* gen_h55(i) { const xs = xs_h55; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = null; } yield (i === 5 ? proxied(xs) : xs).filter(isOdd).map(x => x * 2).reduce((a, b) => a > b ? a : b, i * 2); }
function run_h55(i) { return gen_h55(i).next().value; }
test("h55 nums nullish", run_h55);
const xs_h56 = [{ v: 1, w: 2, on: true, name: 'a' }];
function inner_h56(xs, i) { const lim = i & 3; let count = 0; return xs.filter(function (x) { return x; }).filter(r => r.v).reduce((a, r) => r.on ? a + 1 : a, 0.5); }
function run_h56(i) { const xs = xs_h56; if (i === 4) { xs.length = 1; } return inner_h56(xs, i); }
test("h56 rows shorter", run_h56);
const xs_h57 = ['a', 'bb', '', 'dddd', 'e'];
function* gen_h57(i) { const xs = xs_h57; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = Symbol('s'); } yield str(xs.filter(t => t > 'b').map(t => t.length).filter(x => (x & 1) === 0)); }
function run_h57(i) { return gen_h57(i).next().value; }
test("h57 texts symbol", run_h57);
const xs_h58 = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k }));
function run_h58(i) { const xs = xs_h58; const lim = i & 3; let count = 0; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } try { return str(xs.filter(r => r.v > lim).filter(r => r.name === 'n3')); } catch (e) { return "caught " + e.constructor.name; } }
test("h58 rows longer", run_h58);
class K_h59 { xs = Array.from({ length: 12 }, (_, k) => k * 1.5); lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 5n; } return xs.map(x => x + i).map(x => x + i).reduce((a, b) => b, 1); } }
const k_h59 = new K_h59();
function run_h59(i) { return k_h59.run(i); }
test("h59 nums big", run_h59);
function run_h60(i) { const xs = Array.from({ length: 12 }, (_, k) => k * 1.5); const lim = i & 3; let count = 0; if (i === 4) { xs[0] = 0.25; } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, xs.filter(x => x - 1).map(x => x * 2).filter(x => x < lim).length); return t; }
test("h60 nums doubles", run_h60);
class K_h61 { xs = []; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 5n; } return Object.keys(xs.filter(x => x < lim).map(x => -x)).length; } }
const k_h61 = new K_h61();
function run_h61(i) { return k_h61.run(i); }
test("h61 nums big", run_h61);
const xs_h62 = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k }));
function* gen_h62(i) { const xs = xs_h62; const lim = i & 3; let count = 0; if (i === 4) { xs[0] = NaN; } yield xs.map(r => r.v).reduce((a) => a + 1, 0.5); }
function run_h62(i) { return gen_h62(i).next().value; }
test("h62 rows nan", run_h62);
function run_h63(i) { const xs = [1, 2, 2147483647, -5, 1e10]; const lim = i & 3; let count = 0; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, xs.filter(x => x - 1).map(x => x).filter(x => x > lim ? x < 100 : true).reduce((a, b) => a < b ? b : a, 1)); return t; }
test("h63 nums longer", run_h63);
const xs_h64 = Array.from({ length: 9 }, (_, k) => (k * 7) % 5);
function run_h64(i) { const xs = xs_h64; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = counted(4); xs[2] = counted(2); } return xs.map(x => x > 3 ? x : 0).map(x => x).reduce((a, b) => (a ^ b) | 0, 1); }
test("h64 nums valueOf", run_h64);
const xs_h65 = ['a', 'bb', '', 'dddd', 'e'];
function run_h65(i) { const xs = xs_h65; const lim = i & 3; let count = 0; if (i === 4) { delete xs[1]; } try { return xs.filter(t => t).length; } catch (e) { return "caught " + e.constructor.name; } }
test("h65 texts hole", run_h65);
const xs_h66 = [];
function run_h66(i) { const xs = xs_h66; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = Symbol('s'); } return xs.filter(x => !x).reduce((a, b, k, l) => a + l.length, 1); }
test("h66 nums symbol", run_h66);
const xs_h67 = [];
function* gen_h67(i) { const xs = xs_h67; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 5n; } yield Object.keys(xs.map(x => x).map(Number)).length; }
function run_h67(i) { return gen_h67(i).next().value; }
test("h67 nums big", run_h67);
const xs_h68 = Array.from({ length: 12 }, (_, k) => k * 1.5);
function inner_h68(xs, i) { const lim = i & 3; let count = 0; return xs.map(x => x > 3 ? x : 0).map(x => x + lim).reduce((a, b) => b, lim); }
function run_h68(i) { const xs = xs_h68; if (i === 4) { xs.map = function (f) { said.push('own map'); return Array.prototype.map.call(this, f); }; } return inner_h68(xs, i); }
test("h68 nums own", run_h68);
const xs_h69 = [1, 2, 2147483647, -5, 1e10];
function run_h69(i) { const xs = xs_h69; const lim = i & 3; let count = 0; if (i === 4) { Object.setPrototypeOf(xs, Other.prototype); } return (i === 5 ? like(xs) : xs).filter(x => x % 3 === i % 3).filter(x => x < lim).length + (i === 5 ? like(xs) : xs).filter(x => x % 3 === i % 3).filter(x => x < lim).reduce((a, b) => b, i * 2); }
test("h69 nums proto", run_h69);
const xs_h70 = [{ v: 1, w: 2, on: true, name: 'a' }];
function run_h70(i) { const xs = xs_h70; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = Symbol('s'); } return xs.map(r => r.v).filter(Boolean).length + xs.map(r => r.v).filter(Boolean).reduce((a, b) => a + b, -0); }
test("h70 rows symbol", run_h70);
const xs_h71 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function inner_h71(xs, i) { const lim = i & 3; let count = 0; return (i === 5 ? proxied(xs) : xs).filter((...a) => a.length > 2).reduce((a, b) => a * 3 + b, 1); }
function run_h71(i) { const xs = xs_h71; if (i === 4) { xs.map = function (f) { said.push('own map'); return Array.prototype.map.call(this, f); }; } return inner_h71(xs, i); }
test("h71 nums own", run_h71);
const xs_h72 = [];
function inner_h72(xs, i) { const lim = i & 3; let count = 0; return xs.filter(x => x * 2 > lim).map(x => x / 2)[0]; }
function run_h72(i) { const xs = xs_h72; if (i === 4) {  } return inner_h72(xs, i); }
test("h72 nums none", run_h72);
const xs_h73 = [3];
function run_h73(i) { const xs = xs_h73; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = counted(4); xs[2] = counted(2); } return walked((i === 5 ? like(xs) : xs).map(x => x * 2).map(x => x | 0)); }
test("h73 nums valueOf", run_h73);
const xs_h74 = Array.from({ length: 12 }, (_, k) => k * 1.5);
function run_h74(i) { const xs = xs_h74; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = null; } try { return (i === 5 ? null : xs).map(x => x * 2).filter(x => x * 2 > lim).length; } catch (e) { return "caught " + e.constructor.name; } }
test("h74 nums nullish", run_h74);
const xs_h75 = [{ v: 1, w: 2, on: true, name: 'a' }];
function* gen_h75(i) { const xs = xs_h75; const lim = i & 3; let count = 0; if (i === 4) { xs[1] = 'x3'; } yield xs.map(r => r.w).length + xs.map(r => r.w).reduce((a, b) => (a ^ b) | 0, 0.5); }
function run_h75(i) { return gen_h75(i).next().value; }
test("h75 rows text", run_h75);
const xs_h76 = Array.from({ length: 12 }, (_, k) => k * 1.5);
function run_h76(i) { const xs = xs_h76; const lim = i & 3; let count = 0; if (i === 4) { xs.map = function (f) { said.push('own map'); return Array.prototype.map.call(this, f); }; } return (i === 5 ? proxied(xs) : xs).map(x => x + lim).map(x => x + i).length; }
test("h76 nums own", run_h76);
const xs_h77 = Array.from({ length: 5 }, (_, k) => new Item(k));
function run_h77(i) { const xs = xs_h77; const lim = i & 3; let count = 0; if (i === 4) { xs.length = 1; } return Object.keys((i === 5 ? proxied(xs) : xs).filter(r => r.name === 'n3').filter(r => r.v)).length; }
test("h77 rows shorter", run_h77);
const xs_h78 = Array.from({ length: 5 }, (_, k) => new Item(k));
function run_h78(i) { const xs = xs_h78; const lim = i & 3; let count = 0; if (i === 4) { Object.freeze(xs); } try { return Object.keys((i === 5 ? proxied(xs) : xs).map(r => r.v * 2)).length; } catch (e) { return "caught " + e.constructor.name; } }
test("h78 rows frozen", run_h78);
const xs_h79 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function run_h79(i) { const xs = xs_h79; const lim = i & 3; let count = 0; if (i === 4) { xs[0] = 0.25; } try { return Object.keys((i === 5 ? proxied(xs) : xs).filter(x => x * 2 > lim).map(x => x).filter(x => x - 1)).length; } catch (e) { return "caught " + e.constructor.name; } }
test("h79 nums doubles", run_h79);
class K_h80 { xs = []; lim = 2; run(i) { const xs = this.xs; const lim = i & 3; let count = 0; if (i === 4) { xs.push(xs[0]); xs.push(xs[0]); } return walked((i === 5 ? like(xs) : xs).filter(x => x > 2).map(x => x | 0).filter((...a) => a.length > 2)); } }
const k_h80 = new K_h80();
function run_h80(i) { return k_h80.run(i); }
test("h80 nums longer", run_h80);
function run_h81(i) { const xs = [3]; const lim = i & 3; let count = 0; if (i === 4) { Object.defineProperty(xs, 1, { get() { said.push('index'); return 3; }, configurable: true, enumerable: true }); } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, str(xs.filter(x => x - 1))); return t; }
test("h81 nums indexGetter", run_h81);
const xs_h82 = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
function run_h82(i) { const xs = xs_h82; const lim = i & 3; let count = 0; if (i === 4) {  } try { return str(xs.filter(x => x < lim).map(x => x > 3 ? x : 0).filter(x => !x)); } catch (e) { return "caught " + e.constructor.name; } }
test("h82 nums none", run_h82);
const xs_h83 = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k }));
function run_h83(i) { const xs = xs_h83; const lim = i & 3; let count = 0; if (i === 4) { Object.defineProperty(xs, 1, { get() { said.push('index'); return 3; }, configurable: true, enumerable: true }); } try { return walked((i === 5 ? null : xs).filter(r => r.v).filter(r => r.w < lim)); } catch (e) { return "caught " + e.constructor.name; } }
test("h83 rows indexGetter", run_h83);
function run_h84(i) { const xs = Array.from({ length: 9 }, (_, k) => (k * 7) % 5); const lim = i & 3; let count = 0; if (i === 4) { xs[1] = spy(1); xs[2] = spy(2); } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, Object.keys((i === 5 ? null : xs).map(x => x / 2)).length); return t; }
test("h84 nums getter", run_h84);
function run_h85(i) { const xs = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k })); const lim = i & 3; let count = 0; if (i === 4) { xs[1] = Symbol('s'); } let t = 0; for (let k = 0; k < 3; k++) t = mix(t, (i === 5 ? proxied(xs) : xs).filter(r => r.v > 2).map(r => r.v).filter(x => x < lim).length + (i === 5 ? proxied(xs) : xs).filter(r => r.v > 2).map(r => r.v).filter(x => x < lim).reduce((a, b) => a + b, null)); return t; }
test("h85 rows symbol", run_h85);
const xs_h86 = Array.from({ length: 8 }, (_, k) => ({ v: k * 3 % 7, w: k + 0.5, on: k % 3 === 0, name: 'n' + k }));
function run_h86(i) { const xs = xs_h86; const lim = i & 3; let count = 0; if (i === 4) {  } try { return (i === 5 ? null : xs).map(r => r.w).length; } catch (e) { return "caught " + e.constructor.name; } }
test("h86 rows none", run_h86);
const xs_h87 = [{ v: 1, w: 2, on: true, name: 'a' }];
function* gen_h87(i) { const xs = xs_h87; const lim = i & 3; let count = 0; if (i === 4) { xs.filter = function (f) { said.push('own filter'); return Array.prototype.filter.call(this, f); }; } yield (i === 5 ? like(xs) : xs).map(r => r.v * 2).map(x => x > 3 ? x : 0).length + (i === 5 ? like(xs) : xs).map(r => r.v * 2).map(x => x > 3 ? x : 0).reduce((a, b) => a + b, lim); }
function run_h87(i) { return gen_h87(i).next().value; }
test("h87 rows ownFilter", run_h87);
const xs_h88 = Array.from({ length: 5 }, (_, k) => new Item(k));
function run_h88(i) { const xs = xs_h88; const lim = i & 3; let count = 0; if (i === 4) { Object.freeze(xs); } return xs.filter(r => r.v > 2).reduce((a, b, k) => a + k, 1); }
test("h88 rows frozen", run_h88);
const xs_h89 = Array.from({ length: 9 }, (_, k) => (k * 7) % 5);
function inner_h89(xs, i) { const lim = i & 3; let count = 0; return walked((i === 5 ? proxied(xs) : xs).filter(x => x == 2).map(x => x >>> 1).filter(x => x < lim)); }
function run_h89(i) { const xs = xs_h89; if (i === 4) { xs[30] = xs[0]; } return inner_h89(xs, i); }
test("h89 nums gap", run_h89);
console.log(total);
export {};
