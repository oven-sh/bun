// Frozen arrays of four kinds of element are read, touched by something that a frozen array refuses, passes on or puts up with, and read again, all in one function, so that
// the compiler sees the touch between the two reads: once straight through, once with the touch inside a loop that is under way, and once over arrays made and frozen 20,000 times.
"use strict";
const name = ["ab", "sent"].join(""), symbol = Symbol("absent");
const cases = {};
function f1(a) { const x = a[0]; Object.create(a); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["control-create-ints"] = () => f1(Object.freeze([1, 2, 3, 4]));
function f2(a) { const x = a[0]; Object.create(a); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["control-create-fractions"] = () => f2(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f3(a) { const x = a[0]; Object.create(a); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["control-create-texts"] = () => f3(Object.freeze(["p", "q", "r", "s"]));
function f4(a) { const x = a[0].n; Object.create(a); return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["control-create-objects"] = () => f4(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f5(a) { const x = a[0]; ({ __proto__: a }); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["control-literal-prototype-ints"] = () => f5(Object.freeze([1, 2, 3, 4]));
function f6(a) { const x = a[0]; ({ __proto__: a }); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["control-literal-prototype-fractions"] = () => f6(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f7(a) { const x = a[0]; ({ __proto__: a }); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["control-literal-prototype-texts"] = () => f7(Object.freeze(["p", "q", "r", "s"]));
function f8(a) { const x = a[0].n; ({ __proto__: a }); return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["control-literal-prototype-objects"] = () => f8(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f9(a) { const x = a[0]; try { a.absent = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["named-store-ints"] = () => f9(Object.freeze([1, 2, 3, 4]));
function f10(a) { const x = a[0]; try { a.absent = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["named-store-fractions"] = () => f10(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f11(a) { const x = a[0]; try { a.absent = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["named-store-texts"] = () => f11(Object.freeze(["p", "q", "r", "s"]));
function f12(a) { const x = a[0].n; try { a.absent = 1; } catch {} return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["named-store-objects"] = () => f12(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f13(a) { const x = a[0]; Reflect.set(a, "absent", 1); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["named-store-sloppy-like-ints"] = () => f13(Object.freeze([1, 2, 3, 4]));
function f14(a) { const x = a[0]; Reflect.set(a, "absent", 1); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["named-store-sloppy-like-fractions"] = () => f14(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f15(a) { const x = a[0]; Reflect.set(a, "absent", 1); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["named-store-sloppy-like-texts"] = () => f15(Object.freeze(["p", "q", "r", "s"]));
function f16(a) { const x = a[0].n; Reflect.set(a, "absent", 1); return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["named-store-sloppy-like-objects"] = () => f16(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f17(a) { const x = a[0]; try { a[name] = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["computed-name-store-ints"] = () => f17(Object.freeze([1, 2, 3, 4]));
function f18(a) { const x = a[0]; try { a[name] = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["computed-name-store-fractions"] = () => f18(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f19(a) { const x = a[0]; try { a[name] = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["computed-name-store-texts"] = () => f19(Object.freeze(["p", "q", "r", "s"]));
function f20(a) { const x = a[0].n; try { a[name] = 1; } catch {} return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["computed-name-store-objects"] = () => f20(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f21(a) { const x = a[0]; try { a[symbol] = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["symbol-store-ints"] = () => f21(Object.freeze([1, 2, 3, 4]));
function f22(a) { const x = a[0]; try { a[symbol] = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["symbol-store-fractions"] = () => f22(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f23(a) { const x = a[0]; try { a[symbol] = 1; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["symbol-store-texts"] = () => f23(Object.freeze(["p", "q", "r", "s"]));
function f24(a) { const x = a[0].n; try { a[symbol] = 1; } catch {} return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["symbol-store-objects"] = () => f24(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f25(a) { const x = a[0]; try { a.pop(); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["pop-ints"] = () => f25(Object.freeze([1, 2, 3, 4]));
function f26(a) { const x = a[0]; try { a.pop(); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["pop-fractions"] = () => f26(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f27(a) { const x = a[0]; try { a.pop(); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["pop-texts"] = () => f27(Object.freeze(["p", "q", "r", "s"]));
function f28(a) { const x = a[0].n; try { a.pop(); } catch {} return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["pop-objects"] = () => f28(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f29(a) { const x = a[0]; Object.defineProperty(a, 0, { value: a[0] }); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-element-as-it-is-ints"] = () => f29(Object.freeze([1, 2, 3, 4]));
function f30(a) { const x = a[0]; Object.defineProperty(a, 0, { value: a[0] }); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-element-as-it-is-fractions"] = () => f30(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f31(a) { const x = a[0]; Object.defineProperty(a, 0, { value: a[0] }); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-element-as-it-is-texts"] = () => f31(Object.freeze(["p", "q", "r", "s"]));
function f32(a) { const x = a[0].n; Object.defineProperty(a, 0, { value: a[0] }); return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["define-element-as-it-is-objects"] = () => f32(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f33(a) { const x = a[0]; try { Object.defineProperty(a, "length", { writable: true }); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-length-writable-ints"] = () => f33(Object.freeze([1, 2, 3, 4]));
function f34(a) { const x = a[0]; try { Object.defineProperty(a, "length", { writable: true }); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-length-writable-fractions"] = () => f34(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f35(a) { const x = a[0]; try { Object.defineProperty(a, "length", { writable: true }); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-length-writable-texts"] = () => f35(Object.freeze(["p", "q", "r", "s"]));
function f36(a) { const x = a[0].n; try { Object.defineProperty(a, "length", { writable: true }); } catch {} return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["define-length-writable-objects"] = () => f36(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f37(a) { const x = a[0]; try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-name-ints"] = () => f37(Object.freeze([1, 2, 3, 4]));
function f38(a) { const x = a[0]; try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-name-fractions"] = () => f38(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f39(a) { const x = a[0]; try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["define-name-texts"] = () => f39(Object.freeze(["p", "q", "r", "s"]));
function f40(a) { const x = a[0].n; try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["define-name-objects"] = () => f40(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f41(a) { const x = a[0]; try { Object.setPrototypeOf(a, null); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["set-prototype-null-ints"] = () => f41(Object.freeze([1, 2, 3, 4]));
function f42(a) { const x = a[0]; try { Object.setPrototypeOf(a, null); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["set-prototype-null-fractions"] = () => f42(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f43(a) { const x = a[0]; try { Object.setPrototypeOf(a, null); } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["set-prototype-null-texts"] = () => f43(Object.freeze(["p", "q", "r", "s"]));
function f44(a) { const x = a[0].n; try { Object.setPrototypeOf(a, null); } catch {} return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["set-prototype-null-objects"] = () => f44(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f45(a) { const x = a[0]; Object.setPrototypeOf(a, Array.prototype); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["set-prototype-same-ints"] = () => f45(Object.freeze([1, 2, 3, 4]));
function f46(a) { const x = a[0]; Object.setPrototypeOf(a, Array.prototype); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["set-prototype-same-fractions"] = () => f46(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f47(a) { const x = a[0]; Object.setPrototypeOf(a, Array.prototype); return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["set-prototype-same-texts"] = () => f47(Object.freeze(["p", "q", "r", "s"]));
function f48(a) { const x = a[0].n; Object.setPrototypeOf(a, Array.prototype); return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["set-prototype-same-objects"] = () => f48(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function f49(a) { const x = a[0]; try { a.__proto__ = null; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["proto-assignment-ints"] = () => f49(Object.freeze([1, 2, 3, 4]));
function f50(a) { const x = a[0]; try { a.__proto__ = null; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["proto-assignment-fractions"] = () => f50(Object.freeze([0.5, 1.5, 2.5, 3.5]));
function f51(a) { const x = a[0]; try { a.__proto__ = null; } catch {} return x + " " + a[1] + " " + a[3] + " " + a.length; }
cases["proto-assignment-texts"] = () => f51(Object.freeze(["p", "q", "r", "s"]));
function f52(a) { const x = a[0].n; try { a.__proto__ = null; } catch {} return x + " " + a[1].n + " " + a[3].n + " " + a.length; }
cases["proto-assignment-objects"] = () => f52(Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]));
function loop1(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { Object.create(a); } } return total; }
cases["loop-control-create-ints"] = () => loop1(Object.freeze([1, 2, 3, 4]), 25);
function fresh1(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; Object.create(a); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-control-create-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh1(i & 15); return t; };
function loop2(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { Object.create(a); } } return total; }
cases["loop-control-create-fractions"] = () => loop2(Object.freeze([0.25, 0.5]), 25);
function fresh2(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; Object.create(a); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-control-create-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh2(i & 15); return t; };
function loop3(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { Object.create(a); } } return total; }
cases["loop-control-create-texts"] = () => loop3(Object.freeze(["p", "q"]), 25);
function fresh3(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; Object.create(a); for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-control-create-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh3(i & 15); return t; };
function loop4(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { Object.create(a); } } return total; }
cases["loop-control-create-objects"] = () => loop4(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh4(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; Object.create(a); for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-control-create-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh4(i & 15); return t; };
function loop5(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { ({ __proto__: a }); } } return total; }
cases["loop-control-literal-prototype-ints"] = () => loop5(Object.freeze([1, 2, 3, 4]), 25);
function fresh5(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; ({ __proto__: a }); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-control-literal-prototype-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh5(i & 15); return t; };
function loop6(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { ({ __proto__: a }); } } return total; }
cases["loop-control-literal-prototype-fractions"] = () => loop6(Object.freeze([0.25, 0.5]), 25);
function fresh6(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; ({ __proto__: a }); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-control-literal-prototype-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh6(i & 15); return t; };
function loop7(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { ({ __proto__: a }); } } return total; }
cases["loop-control-literal-prototype-texts"] = () => loop7(Object.freeze(["p", "q"]), 25);
function fresh7(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; ({ __proto__: a }); for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-control-literal-prototype-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh7(i & 15); return t; };
function loop8(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { ({ __proto__: a }); } } return total; }
cases["loop-control-literal-prototype-objects"] = () => loop8(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh8(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; ({ __proto__: a }); for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-control-literal-prototype-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh8(i & 15); return t; };
function loop9(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a.absent = 1; } catch {} } } return total; }
cases["loop-named-store-ints"] = () => loop9(Object.freeze([1, 2, 3, 4]), 25);
function fresh9(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a.absent = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-named-store-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh9(i & 15); return t; };
function loop10(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a.absent = 1; } catch {} } } return total; }
cases["loop-named-store-fractions"] = () => loop10(Object.freeze([0.25, 0.5]), 25);
function fresh10(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a.absent = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-named-store-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh10(i & 15); return t; };
function loop11(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { try { a.absent = 1; } catch {} } } return total; }
cases["loop-named-store-texts"] = () => loop11(Object.freeze(["p", "q"]), 25);
function fresh11(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; try { a.absent = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-named-store-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh11(i & 15); return t; };
function loop12(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { try { a.absent = 1; } catch {} } } return total; }
cases["loop-named-store-objects"] = () => loop12(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh12(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; try { a.absent = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-named-store-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh12(i & 15); return t; };
function loop13(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { Reflect.set(a, "absent", 1); } } return total; }
cases["loop-reflect-set-ints"] = () => loop13(Object.freeze([1, 2, 3, 4]), 25);
function fresh13(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; Reflect.set(a, "absent", 1); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-reflect-set-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh13(i & 15); return t; };
function loop14(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { Reflect.set(a, "absent", 1); } } return total; }
cases["loop-reflect-set-fractions"] = () => loop14(Object.freeze([0.25, 0.5]), 25);
function fresh14(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; Reflect.set(a, "absent", 1); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-reflect-set-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh14(i & 15); return t; };
function loop15(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { Reflect.set(a, "absent", 1); } } return total; }
cases["loop-reflect-set-texts"] = () => loop15(Object.freeze(["p", "q"]), 25);
function fresh15(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; Reflect.set(a, "absent", 1); for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-reflect-set-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh15(i & 15); return t; };
function loop16(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { Reflect.set(a, "absent", 1); } } return total; }
cases["loop-reflect-set-objects"] = () => loop16(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh16(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; Reflect.set(a, "absent", 1); for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-reflect-set-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh16(i & 15); return t; };
function loop17(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a[name] = 1; } catch {} } } return total; }
cases["loop-computed-name-store-ints"] = () => loop17(Object.freeze([1, 2, 3, 4]), 25);
function fresh17(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a[name] = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-computed-name-store-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh17(i & 15); return t; };
function loop18(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a[name] = 1; } catch {} } } return total; }
cases["loop-computed-name-store-fractions"] = () => loop18(Object.freeze([0.25, 0.5]), 25);
function fresh18(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a[name] = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-computed-name-store-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh18(i & 15); return t; };
function loop19(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { try { a[name] = 1; } catch {} } } return total; }
cases["loop-computed-name-store-texts"] = () => loop19(Object.freeze(["p", "q"]), 25);
function fresh19(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; try { a[name] = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-computed-name-store-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh19(i & 15); return t; };
function loop20(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { try { a[name] = 1; } catch {} } } return total; }
cases["loop-computed-name-store-objects"] = () => loop20(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh20(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; try { a[name] = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-computed-name-store-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh20(i & 15); return t; };
function loop21(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a[symbol] = 1; } catch {} } } return total; }
cases["loop-symbol-store-ints"] = () => loop21(Object.freeze([1, 2, 3, 4]), 25);
function fresh21(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a[symbol] = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-symbol-store-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh21(i & 15); return t; };
function loop22(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a[symbol] = 1; } catch {} } } return total; }
cases["loop-symbol-store-fractions"] = () => loop22(Object.freeze([0.25, 0.5]), 25);
function fresh22(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a[symbol] = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-symbol-store-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh22(i & 15); return t; };
function loop23(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { try { a[symbol] = 1; } catch {} } } return total; }
cases["loop-symbol-store-texts"] = () => loop23(Object.freeze(["p", "q"]), 25);
function fresh23(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; try { a[symbol] = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-symbol-store-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh23(i & 15); return t; };
function loop24(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { try { a[symbol] = 1; } catch {} } } return total; }
cases["loop-symbol-store-objects"] = () => loop24(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh24(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; try { a[symbol] = 1; } catch {} for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-symbol-store-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh24(i & 15); return t; };
function loop25(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a.pop(); } catch {} } } return total; }
cases["loop-pop-ints"] = () => loop25(Object.freeze([1, 2, 3, 4]), 25);
function fresh25(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a.pop(); } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-pop-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh25(i & 15); return t; };
function loop26(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a.pop(); } catch {} } } return total; }
cases["loop-pop-fractions"] = () => loop26(Object.freeze([0.25, 0.5]), 25);
function fresh26(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a.pop(); } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-pop-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh26(i & 15); return t; };
function loop27(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { try { a.pop(); } catch {} } } return total; }
cases["loop-pop-texts"] = () => loop27(Object.freeze(["p", "q"]), 25);
function fresh27(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; try { a.pop(); } catch {} for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-pop-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh27(i & 15); return t; };
function loop28(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { try { a.pop(); } catch {} } } return total; }
cases["loop-pop-objects"] = () => loop28(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh28(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; try { a.pop(); } catch {} for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-pop-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh28(i & 15); return t; };
function loop29(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { Object.defineProperty(a, 0, { value: a[0] }); } } return total; }
cases["loop-define-element-as-it-is-ints"] = () => loop29(Object.freeze([1, 2, 3, 4]), 25);
function fresh29(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; Object.defineProperty(a, 0, { value: a[0] }); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-define-element-as-it-is-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh29(i & 15); return t; };
function loop30(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { Object.defineProperty(a, 0, { value: a[0] }); } } return total; }
cases["loop-define-element-as-it-is-fractions"] = () => loop30(Object.freeze([0.25, 0.5]), 25);
function fresh30(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; Object.defineProperty(a, 0, { value: a[0] }); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-define-element-as-it-is-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh30(i & 15); return t; };
function loop31(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { Object.defineProperty(a, 0, { value: a[0] }); } } return total; }
cases["loop-define-element-as-it-is-texts"] = () => loop31(Object.freeze(["p", "q"]), 25);
function fresh31(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; Object.defineProperty(a, 0, { value: a[0] }); for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-define-element-as-it-is-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh31(i & 15); return t; };
function loop32(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { Object.defineProperty(a, 0, { value: a[0] }); } } return total; }
cases["loop-define-element-as-it-is-objects"] = () => loop32(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh32(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; Object.defineProperty(a, 0, { value: a[0] }); for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-define-element-as-it-is-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh32(i & 15); return t; };
function loop33(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { Object.defineProperty(a, "length", { writable: true }); } catch {} } } return total; }
cases["loop-define-length-writable-ints"] = () => loop33(Object.freeze([1, 2, 3, 4]), 25);
function fresh33(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { Object.defineProperty(a, "length", { writable: true }); } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-define-length-writable-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh33(i & 15); return t; };
function loop34(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { Object.defineProperty(a, "length", { writable: true }); } catch {} } } return total; }
cases["loop-define-length-writable-fractions"] = () => loop34(Object.freeze([0.25, 0.5]), 25);
function fresh34(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { Object.defineProperty(a, "length", { writable: true }); } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-define-length-writable-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh34(i & 15); return t; };
function loop35(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { try { Object.defineProperty(a, "length", { writable: true }); } catch {} } } return total; }
cases["loop-define-length-writable-texts"] = () => loop35(Object.freeze(["p", "q"]), 25);
function fresh35(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; try { Object.defineProperty(a, "length", { writable: true }); } catch {} for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-define-length-writable-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh35(i & 15); return t; };
function loop36(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { try { Object.defineProperty(a, "length", { writable: true }); } catch {} } } return total; }
cases["loop-define-length-writable-objects"] = () => loop36(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh36(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; try { Object.defineProperty(a, "length", { writable: true }); } catch {} for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-define-length-writable-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh36(i & 15); return t; };
function loop37(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} } } return total; }
cases["loop-define-name-ints"] = () => loop37(Object.freeze([1, 2, 3, 4]), 25);
function fresh37(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-define-name-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh37(i & 15); return t; };
function loop38(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} } } return total; }
cases["loop-define-name-fractions"] = () => loop38(Object.freeze([0.25, 0.5]), 25);
function fresh38(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-define-name-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh38(i & 15); return t; };
function loop39(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} } } return total; }
cases["loop-define-name-texts"] = () => loop39(Object.freeze(["p", "q"]), 25);
function fresh39(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-define-name-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh39(i & 15); return t; };
function loop40(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} } } return total; }
cases["loop-define-name-objects"] = () => loop40(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh40(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; try { Object.defineProperty(a, "absent", { value: 1 }); } catch {} for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-define-name-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh40(i & 15); return t; };
function loop41(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { Object.setPrototypeOf(a, null); } catch {} } } return total; }
cases["loop-set-prototype-null-ints"] = () => loop41(Object.freeze([1, 2, 3, 4]), 25);
function fresh41(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { Object.setPrototypeOf(a, null); } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-set-prototype-null-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh41(i & 15); return t; };
function loop42(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { Object.setPrototypeOf(a, null); } catch {} } } return total; }
cases["loop-set-prototype-null-fractions"] = () => loop42(Object.freeze([0.25, 0.5]), 25);
function fresh42(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { Object.setPrototypeOf(a, null); } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-set-prototype-null-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh42(i & 15); return t; };
function loop43(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { try { Object.setPrototypeOf(a, null); } catch {} } } return total; }
cases["loop-set-prototype-null-texts"] = () => loop43(Object.freeze(["p", "q"]), 25);
function fresh43(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; try { Object.setPrototypeOf(a, null); } catch {} for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-set-prototype-null-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh43(i & 15); return t; };
function loop44(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { try { Object.setPrototypeOf(a, null); } catch {} } } return total; }
cases["loop-set-prototype-null-objects"] = () => loop44(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh44(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; try { Object.setPrototypeOf(a, null); } catch {} for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-set-prototype-null-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh44(i & 15); return t; };
function loop45(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { Object.setPrototypeOf(a, Array.prototype); } } return total; }
cases["loop-set-prototype-same-ints"] = () => loop45(Object.freeze([1, 2, 3, 4]), 25);
function fresh45(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; Object.setPrototypeOf(a, Array.prototype); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-set-prototype-same-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh45(i & 15); return t; };
function loop46(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { Object.setPrototypeOf(a, Array.prototype); } } return total; }
cases["loop-set-prototype-same-fractions"] = () => loop46(Object.freeze([0.25, 0.5]), 25);
function fresh46(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; Object.setPrototypeOf(a, Array.prototype); for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-set-prototype-same-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh46(i & 15); return t; };
function loop47(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { Object.setPrototypeOf(a, Array.prototype); } } return total; }
cases["loop-set-prototype-same-texts"] = () => loop47(Object.freeze(["p", "q"]), 25);
function fresh47(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; Object.setPrototypeOf(a, Array.prototype); for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-set-prototype-same-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh47(i & 15); return t; };
function loop48(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { Object.setPrototypeOf(a, Array.prototype); } } return total; }
cases["loop-set-prototype-same-objects"] = () => loop48(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh48(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; Object.setPrototypeOf(a, Array.prototype); for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-set-prototype-same-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh48(i & 15); return t; };
function loop49(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a.__proto__ = null; } catch {} } } return total; }
cases["loop-proto-assignment-ints"] = () => loop49(Object.freeze([1, 2, 3, 4]), 25);
function fresh49(k) { const a = Object.freeze([1, 2, 3, 4]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a.__proto__ = null; } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-proto-assignment-ints"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh49(i & 15); return t; };
function loop50(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i]; if (turn === turnOfChange) { try { a.__proto__ = null; } catch {} } } return total; }
cases["loop-proto-assignment-fractions"] = () => loop50(Object.freeze([0.25, 0.5]), 25);
function fresh50(k) { const a = Object.freeze([0.25, 0.5]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; try { a.__proto__ = null; } catch {} for (let i = 0; i < a.length; i++) total += a[i]; return total + k; }
cases["fresh-proto-assignment-fractions"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh50(i & 15); return t; };
function loop51(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].length; if (turn === turnOfChange) { try { a.__proto__ = null; } catch {} } } return total; }
cases["loop-proto-assignment-texts"] = () => loop51(Object.freeze(["p", "q"]), 25);
function fresh51(k) { const a = Object.freeze(["p", "q"]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].length; try { a.__proto__ = null; } catch {} for (let i = 0; i < a.length; i++) total += a[i].length; return total + k; }
cases["fresh-proto-assignment-texts"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh51(i & 15); return t; };
function loop52(a, turnOfChange) { let total = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < a.length; i++) total += a[i].n; if (turn === turnOfChange) { try { a.__proto__ = null; } catch {} } } return total; }
cases["loop-proto-assignment-objects"] = () => loop52(Object.freeze([{ n: 1 }, { n: 2 }]), 25);
function fresh52(k) { const a = Object.freeze([{ n: 1 }, { n: 2 }]); let total = 0; for (let i = 0; i < a.length; i++) total += a[i].n; try { a.__proto__ = null; } catch {} for (let i = 0; i < a.length; i++) total += a[i].n; return total + k; }
cases["fresh-proto-assignment-objects"] = () => { let t = 0; for (let i = 0; i < 20000; i++) t += fresh52(i & 15); return t; };
for (const which of Object.keys(cases)) console.log(which + " " + cases[which]());
