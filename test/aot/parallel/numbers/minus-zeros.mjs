// Minus zero in every fold with zero, in products, negations, remainders, roundings, least and greatest numbers, and in sums of loops.
const show = x => (Object.is(x, -0) ? "-0" : String(x));
const out = [];
const values = [0, -0, 1, -1, 0.5, -0.5, 2, -3, NaN, 2147483647, -2147483648, 4294967296, 2 ** 53, Infinity];
const doubles = new Float64Array(values);
const words = new Int32Array([0, 1, -1, 4, 0, 0, 2, 9]);
function fold0(x) { return x + 0; }
function fold1(x) { return 0 + x; }
function fold2(x) { return x - 0; }
function fold3(x) { return 0 - x; }
function fold4(x) { return x * 0; }
function fold5(x) { return 0 * x; }
function fold6(x) { return x * 1; }
function fold7(x) { return x * -1; }
function fold8(x) { return -x; }
function fold9(x) { return -(-x); }
function fold10(x) { return x / 1; }
function fold11(x) { return x / -1; }
function fold12(x) { return 0 / x; }
function fold13(x) { return x / 2; }
function fold14(x) { return x % 2; }
function fold15(x) { return x % 1; }
function fold16(x) { return -x % 4; }
function fold17(x) { return x | 0; }
function fold18(x) { return ~~x; }
function fold19(x) { return +x; }
function fold20(x) { return x >> 0; }
function fold21(x) { return x >>> 0; }
function fold22(x) { return x & 3; }
function fold23(x) { return -(x & 3); }
function fold24(x) { return (x & 3) * -1; }
function fold25(x) { return (x & 3) * 0; }
function fold26(x) { return (x | 0) * -2; }
function fold27(x) { return -(x | 0); }
function fold28(x) { return (x | 0) % 2; }
function fold29(x) { return -((x | 0) % 3); }
function fold30(x) { return (x | 0) / -4; }
function fold31(x) { return 0 - (x | 0); }
function fold32(x) { return (x >>> 0) * -1; }
function fold33(x) { return x + -0; }
function fold34(x) { return -0 + x; }
function fold35(x) { return x - -0; }
function fold36(x) { return -0 - x; }
function fold37(x) { return x * -0; }
function fold38(x) { return -0 * x; }
function fold39(x) { return 2 * x; }
function fold40(x) { return x - x; }
function fold41(x) { return x + x; }
function fold42(x) { return x * x; }
function fold43(x) { return x ** 1; }
function fold44(x) { return x ** 3; }
function fold45(x) { return Math.max(x, 0); }
function fold46(x) { return Math.max(0, x); }
function fold47(x) { return Math.max(x, -0); }
function fold48(x) { return Math.min(x, 0); }
function fold49(x) { return Math.min(0, x); }
function fold50(x) { return Math.min(-0, x); }
function fold51(x) { return Math.max(-x, x); }
function fold52(x) { return Math.min(-x, x); }
function fold53(x) { return Math.round(x); }
function fold54(x) { return Math.round(x * 0.5); }
function fold55(x) { return Math.trunc(x); }
function fold56(x) { return Math.trunc(x / 4); }
function fold57(x) { return Math.ceil(x); }
function fold58(x) { return Math.ceil(x - 0.5); }
function fold59(x) { return Math.floor(x); }
function fold60(x) { return Math.floor(-x); }
function fold61(x) { return Math.sign(x); }
function fold62(x) { return Math.abs(x); }
function fold63(x) { return -Math.abs(x); }
function fold64(x) { return Math.fround(x); }
function fold65(x) { return Math.sqrt(x); }
function fold66(x) { return Math.imul(x, -1); }
function fold67(x) { return -Math.imul(x, 0); }
function fold68(x) { return Number(String(x)); }
function fold69(x) { return Number("-" + x); }
function fold70(x) { return parseFloat("-0") + x; }
function fold71(x) { return JSON.parse("-0") + x; }
function fold72(x) { return x < 0 ? x : -x; }
function fold73(x) { return x ? x : -0; }
function fold74(x) { return x || -0; }
function fold75(x) { return x && -x; }
function fold76(x) { return x ?? 0; }
function fold77(x) { return Math.max(...[x, -0]); }
function fold78(x) { return Math.min(x, -0, 0); }
function fold79(x) { return Math.max(x, -0, 0); }
function fold80(x) { return (x - 1) + 1; }
function fold81(x) { return (x + 1) - 1; }
function fold82(x) { return x * 2 - x * 2; }
function fold83(x) { return -(x - x); }
function fold84(x) { return [x, -x].reduce((a, b) => a + b); }
function fold85(x) { return [x].reduce((a, b) => a + b, -0); }
function fold86(x) { return 1 / x; }
const folds = [fold0, fold1, fold2, fold3, fold4, fold5, fold6, fold7, fold8, fold9, fold10, fold11, fold12, fold13, fold14, fold15, fold16, fold17, fold18, fold19, fold20, fold21, fold22, fold23, fold24, fold25, fold26, fold27, fold28, fold29, fold30, fold31, fold32, fold33, fold34, fold35, fold36, fold37, fold38, fold39, fold40, fold41, fold42, fold43, fold44, fold45, fold46, fold47, fold48, fold49, fold50, fold51, fold52, fold53, fold54, fold55, fold56, fold57, fold58, fold59, fold60, fold61, fold62, fold63, fold64, fold65, fold66, fold67, fold68, fold69, fold70, fold71, fold72, fold73, fold74, fold75, fold76, fold77, fold78, fold79, fold80, fold81, fold82, fold83, fold84, fold85, fold86];
for (const fold of folds) out.push(values.map(x => show(fold(x))).join());
for (let i = -2; i < 3; i++) out.push(show(fold0(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold1(words[i])) + show(fold1(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold2(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold3(words[i])) + show(fold3(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold4(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold5(words[i])) + show(fold5(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold6(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold7(words[i])) + show(fold7(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold8(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold9(words[i])) + show(fold9(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold10(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold11(words[i])) + show(fold11(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold12(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold13(words[i])) + show(fold13(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold14(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold15(words[i])) + show(fold15(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold16(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold17(words[i])) + show(fold17(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold18(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold19(words[i])) + show(fold19(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold20(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold21(words[i])) + show(fold21(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold22(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold23(words[i])) + show(fold23(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold24(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold25(words[i])) + show(fold25(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold26(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold27(words[i])) + show(fold27(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold28(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold29(words[i])) + show(fold29(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold30(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold31(words[i])) + show(fold31(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold32(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold33(words[i])) + show(fold33(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold34(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold35(words[i])) + show(fold35(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold36(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold37(words[i])) + show(fold37(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold38(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold39(words[i])) + show(fold39(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold40(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold41(words[i])) + show(fold41(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold42(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold43(words[i])) + show(fold43(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold44(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold45(words[i])) + show(fold45(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold46(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold47(words[i])) + show(fold47(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold48(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold49(words[i])) + show(fold49(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold50(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold51(words[i])) + show(fold51(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold52(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold53(words[i])) + show(fold53(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold54(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold55(words[i])) + show(fold55(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold56(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold57(words[i])) + show(fold57(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold58(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold59(words[i])) + show(fold59(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold60(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold61(words[i])) + show(fold61(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold62(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold63(words[i])) + show(fold63(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold64(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold65(words[i])) + show(fold65(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold66(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold67(words[i])) + show(fold67(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold68(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold69(words[i])) + show(fold69(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold70(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold71(words[i])) + show(fold71(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold72(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold73(words[i])) + show(fold73(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold74(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold75(words[i])) + show(fold75(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold76(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold77(words[i])) + show(fold77(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold78(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold79(words[i])) + show(fold79(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold80(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold81(words[i])) + show(fold81(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold82(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold83(words[i])) + show(fold83(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold84(i)));
for (let i = 0; i < words.length; i++) out.push(show(fold85(words[i])) + show(fold85(doubles[i])));
for (let i = -2; i < 3; i++) out.push(show(fold86(i)));
function once(make) { let done = false, value; return (...given) => { if (!done) { done = true; value = make(...given); } return value; }; }
const negated = once(x => x * -1), zeroed = once(x => x * 0), kept = once(() => -0);
const box = { v: -0 };
const ints = [0, 1, 2, 3, -1, 0, 5, 7], zeros = [-0, -0, -0, -0, -0, -0, -0, -0, -0], mixed = [-0, 0, -0, 0.5];
function add0(t, s, v) { for (let k = 0; k < t; k++) s += box.v; return s; }
function take0(t, s, v) { for (let k = 0; k < t; k++) s -= box.v; return s; }
function add1(t, s, v) { for (let k = 0; k < t; k++) s += negated(k); return s; }
function take1(t, s, v) { for (let k = 0; k < t; k++) s -= negated(k); return s; }
function add2(t, s, v) { for (let k = 0; k < t; k++) s += zeroed(k); return s; }
function take2(t, s, v) { for (let k = 0; k < t; k++) s -= zeroed(k); return s; }
function add3(t, s, v) { for (let k = 0; k < t; k++) s += kept(); return s; }
function take3(t, s, v) { for (let k = 0; k < t; k++) s -= kept(); return s; }
function add4(t, s, v) { for (let k = 0; k < t; k++) s += -ints[k & 7]; return s; }
function take4(t, s, v) { for (let k = 0; k < t; k++) s -= -ints[k & 7]; return s; }
function add5(t, s, v) { for (let k = 0; k < t; k++) s += ints[k & 7] * 0; return s; }
function take5(t, s, v) { for (let k = 0; k < t; k++) s -= ints[k & 7] * 0; return s; }
function add6(t, s, v) { for (let k = 0; k < t; k++) s += zeros[k % 9]; return s; }
function take6(t, s, v) { for (let k = 0; k < t; k++) s -= zeros[k % 9]; return s; }
function add7(t, s, v) { for (let k = 0; k < t; k++) s += mixed[k & 3]; return s; }
function take7(t, s, v) { for (let k = 0; k < t; k++) s -= mixed[k & 3]; return s; }
function add8(t, s, v) { for (let k = 0; k < t; k++) s += doubles[k & 7]; return s; }
function take8(t, s, v) { for (let k = 0; k < t; k++) s -= doubles[k & 7]; return s; }
function add9(t, s, v) { for (let k = 0; k < t; k++) s += words[k & 7] * -1; return s; }
function take9(t, s, v) { for (let k = 0; k < t; k++) s -= words[k & 7] * -1; return s; }
function add10(t, s, v) { for (let k = 0; k < t; k++) s += words[k & 7] * 0; return s; }
function take10(t, s, v) { for (let k = 0; k < t; k++) s -= words[k & 7] * 0; return s; }
function add11(t, s, v) { for (let k = 0; k < t; k++) s += k * 0; return s; }
function take11(t, s, v) { for (let k = 0; k < t; k++) s -= k * 0; return s; }
function add12(t, s, v) { for (let k = 0; k < t; k++) s += -(k & 3); return s; }
function take12(t, s, v) { for (let k = 0; k < t; k++) s -= -(k & 3); return s; }
function add13(t, s, v) { for (let k = 0; k < t; k++) s += v; return s; }
function take13(t, s, v) { for (let k = 0; k < t; k++) s -= v; return s; }
function add14(t, s, v) { for (let k = 0; k < t; k++) s += -v; return s; }
function take14(t, s, v) { for (let k = 0; k < t; k++) s -= -v; return s; }
function add15(t, s, v) { for (let k = 0; k < t; k++) s += v * 0; return s; }
function take15(t, s, v) { for (let k = 0; k < t; k++) s -= v * 0; return s; }
function add16(t, s, v) { for (let k = 0; k < t; k++) s += 0; return s; }
function take16(t, s, v) { for (let k = 0; k < t; k++) s -= 0; return s; }
function add17(t, s, v) { for (let k = 0; k < t; k++) s += -0; return s; }
function take17(t, s, v) { for (let k = 0; k < t; k++) s -= -0; return s; }
function add18(t, s, v) { for (let k = 0; k < t; k++) s += Math.min(v, 0); return s; }
function take18(t, s, v) { for (let k = 0; k < t; k++) s -= Math.min(v, 0); return s; }
function add19(t, s, v) { for (let k = 0; k < t; k++) s += k & 1 ? 0 : -0; return s; }
function take19(t, s, v) { for (let k = 0; k < t; k++) s -= k & 1 ? 0 : -0; return s; }
function add20(t, s, v) { for (let k = 0; k < t; k++) s += -(k % 1); return s; }
function take20(t, s, v) { for (let k = 0; k < t; k++) s -= -(k % 1); return s; }
function run(f) { for (const n of [0, -0, 0.5]) for (const t of [0, 1, 9, 100, (1 << 18) + 9]) for (const v of [0, -0, 3]) out.push(show(f(t, n, v))); }
run(add0); run(take0);
run(add1); run(take1);
run(add2); run(take2);
run(add3); run(take3);
run(add4); run(take4);
run(add5); run(take5);
run(add6); run(take6);
run(add7); run(take7);
run(add8); run(take8);
run(add9); run(take9);
run(add10); run(take10);
run(add11); run(take11);
run(add12); run(take12);
run(add13); run(take13);
run(add14); run(take14);
run(add15); run(take15);
run(add16); run(take16);
run(add17); run(take17);
run(add18); run(take18);
run(add19); run(take19);
run(add20); run(take20);
out.push(show(zeros.reduce((a, b) => a + b)), show(zeros.reduce((a, b) => a + b, -0)), show(zeros.reduce((a, b) => a + b, 0)), show(mixed.reduce((a, b) => Math.min(a, b))), show(mixed.reduce((a, b) => Math.max(a, b))));
for (const list of [zeros, ints, mixed, words, doubles]) { let sum = -0, product = -1; for (const x of list) { sum += x * 0; product *= x; } out.push(show(sum), show(product)); }
out.push(show(Math.min(...zeros, 0)), show(Math.max(...zeros)), show(zeros.map(x => x * -1).reduce((a, b) => a * b, -0)), show(new Map([[-0, 1]]).keys().next().value));
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, hash);
for (let i = 0; i < out.length; i += 16) console.log(out.slice(i, i + 16).join(" "));
