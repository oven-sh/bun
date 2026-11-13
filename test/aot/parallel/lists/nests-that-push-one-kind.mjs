// Nests that push onto one literal in several places: values of one kind that no turn changes. Red where a loop counts on a length that another push changes.
function add1(o, v) { o.push(v); }
function add2(o, v) { for (let z = 0; z < 2; z++) o.push(v); }
function f0(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let t = 0; t < 2; t++) { for (let i = 1; i < n; i++) { a.push(l[c]); a.push(l[c]); } } return a; }
function f1(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { a.push(d[c]); } return a; }
function f2(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { for (let q = 0; q < i; q++) { a.push(q); } a.push(l[c]); } return a; }
function f3(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 26; i++) { a.push(l[c] * 2); if (c) a.push(l[c] * 2); for (let q = 0; q < 3; q++) { a.push(l[c] * 2); for (let r = 0; r < 1; r++) { a[r] = l[c] * 2; } } } return a; }
function f4(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 3; i++) { if (i & 1) a.pop(); add2(a, m[c]); } return a; }
function f5(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let t = 0; t < 2; t++) { for (let i = 0; i < 8; i++) { add1(a, d[c]); a.push(d[c]); } } return a; }
function f6(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < n; i++) { a.push(d[c]); } return a; }
function f7(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 8; i++) { if (i & 1) a.push(l[c] * 2); } return a; }
function f8(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 26; i++) { a.push(l[c]); a.push(l[c] + 0.5); for (let q = 0; q < 1; q++) { a.push(l[c]); for (let r = 0; r < c + 1; r++) { a.push(l[c]); } } } return a; }
function f9(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 24; i++) { if (i & c) a.push(i); } return a; }
function f10(c, m, n, w) { const a = []; const b = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 4; i++) { add1(a, d[c]); a.push(d[c]); for (let q = 0; q < n; q++) { b.push(d[c]); } } return a.concat(b); }
function f11(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 8; i++) { if (c) a[i] = l[c] * 2; add1(a, l[c] * 2); for (let q = 0; q < c + 1; q++) { a.push(l[c]); } } return a; }
function f12(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 24; i++) { if (i & 1) a.pop(); for (let q = 0; q < n; q++) { a.push(l[c]); } a[a.length] = l[c]; } return a; }
function f13(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 26; i++) { a.push(l[c]); add2(a, l[c] + 1); } return a; }
function f14(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { for (let q = 0; q < c + 1; q++) { a.push(l[c]); for (let r = 0; r < c + 1; r++) { a.push(l[c]); } } for (let q = 0; q < i; q++) { a.push(l[c]); } for (let q = 0; q < 1; q++) { a.push(l[c]); } } return a; }
function f15(c, m, n, w) { const a = []; const b = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 4; i++) { for (let q = 0; q < 3; q++) { a.push(l[c] * 2); for (let r = 0; r < 1; r++) { b.push(l[c] * 2); } } b.push(l[c] * 2); } return a.concat(b); }
function f16(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let t = 0; t < 2; t++) { for (let i = 0; i < n; i++) { for (let q = 0; q < 3; q++) { a.push(l[c] + 0.5); } if (i & 1) a.pop(); } } return a; }
function f17(c, m, n, w) { const a = [0.5]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 3; i++) { if (i & 1) a.push(l[c] + 1); if (i & c) a.push(l[c] + 1); if (i & 1) a.pop(); } return a; }
function f18(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 8; i++) { a.push(m[c]); a.push(m[c]); } return a; }
function f19(c, m, n, w) { const a = []; const b = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 3; i++) { for (let q = 0; q < n; q++) { a.push(l[c]); } for (let q = 0; q < n; q++) { a.push(l[c]); } if (i === 2) b.length = 1; } return a.concat(b); }
function f20(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 4; i++) { add1(a, l[c] + 1); } return a; }
function f21(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 8; i++) { a.push(l[c] + 0.5); a.push(l[c] * 2); for (let q = 0; q < 2; q++) { a[a.length] = l[c] * 2; } } return a; }
function f22(c, m, n, w) { const a = [1]; const b = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let t = 0; t < 2; t++) { for (let i = 0; i < n; i++) { b.push(d[c]); for (let q = 0; q < 1; q++) { a.push(d[c]); } } } return a.concat(b); }
function f23(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 8; i++) { for (let q = 0; q < 1; q++) { a.push(d[c]); for (let r = 0; r < n; r++) { a.push(d[c]); } } a.push(d[c]); for (let q = 0; q < n; q++) { s += a.push(d[c]); } } return a; }
function f24(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < n; i++) { for (let q = 0; q < c + 1; q++) { a.push(l[c] + 0.5); } } return a; }
function f25(c, m, n, w) { const a = [0.5]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { add2(a, l[c] + 0.5); for (let q = 0; q < 2; q++) { a[a.length] = l[c] + 0.5; } } return a; }
function f26(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 24; i++) { for (let q = 0; q < c + 1; q++) { a.push(m[c]); } a.push(m[c]); } return a; }
function f27(c, m, n, w) { const a = [0.5]; const b = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { b.push(l[c]); if (i === 2) a.length = 1; } return a.concat(b); }
function f28(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < n; i++) { if (i & 1) a.pop(); if (i & c) a.push(w); } return a; }
function f29(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 26; i++) { a[i] = l[c] + 0.5; for (let q = 0; q < n; q++) { a.push(l[c] + 0.5); } a.push(l[c] + 0.5); } return a; }
function f30(c, m, n, w) { const a = [0.5]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 26; i++) { a.push(i); a.push(d[c]); } return a; }
function f31(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 4; i++) { a.push(l[c]); if (c) a.push(l[c]); } return a; }
function f32(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 4; i++) { a.push(w); add2(a, w); a.push(w); } return a; }
function f33(c, m, n, w) { const a = []; const b = [0.5]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { for (let q = 0; q < 1; q++) { s += a.push(l[c]); } for (let q = 0; q < 3; q++) { b.push(l[c]); } } return a.concat(b); }
function f34(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { if (i & c) a.push(l[c] + 0.5); a.push(l[c] + 0.5); } return a; }
function f35(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 1; i < 3; i++) { if (i & c) a.push(l[c]); if (i === 2) a.length = 1; } return a; }
function f36(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { add2(a, l[c] + 1); a.push(l[c] + 1); for (let q = 0; q < i; q++) { a.push(l[c] + 1); } } return a; }
function f37(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let t = 0; t < 2; t++) { for (let i = 1; i < 24; i++) { for (let q = 0; q < 1; q++) { a.push(d[c]); } for (let q = 0; q < c + 1; q++) { a.push(w); } } } return a; }
function f38(c, m, n, w) { const a = [1]; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let i = 0; i < 3; i++) { a.push(l[c]); a.push(l[c]); } return a; }
function f39(c, m, n, w) { const a = []; const l = [1, 2, 3], d = [0.5, 1.5, 2.5]; let s = 0; for (let t = 0; t < 2; t++) { for (let i = 1; i < 24; i++) { s += a.push(d[c]); } } return a; }
const show = l => "[" + l.map(x => Object.is(x, -0) ? "-0" : String(x)).join() + "]" + l.length;
const m4 = [4, 5, 6, 7], m5 = [0.5, 4.5, 5.5];
for (let turn = 0; turn < 3; turn++) for (const c of [0, 1, 2]) {
  console.log(0, c, show(f0(c, m4, 5, 2)), show(f0(c, m5, 3, 2)));
  console.log(1, c, show(f1(c, m4, 5, 2)), show(f1(c, m5, 3, 2)));
  console.log(2, c, show(f2(c, m4, 5, 2)), show(f2(c, m5, 3, 2)));
  console.log(3, c, show(f3(c, m4, 5, 2)), show(f3(c, m5, 3, 2)));
  console.log(4, c, show(f4(c, m4, 5, 2)), show(f4(c, m5, 3, 2)));
  console.log(5, c, show(f5(c, m4, 5, 2)), show(f5(c, m5, 3, 2)));
  console.log(6, c, show(f6(c, m4, 5, 2)), show(f6(c, m5, 3, 2)));
  console.log(7, c, show(f7(c, m4, 5, 2)), show(f7(c, m5, 3, 2)));
  console.log(8, c, show(f8(c, m4, 5, 2)), show(f8(c, m5, 3, 2)));
  console.log(9, c, show(f9(c, m4, 5, 2)), show(f9(c, m5, 3, 2)));
  console.log(10, c, show(f10(c, m4, 5, 2)), show(f10(c, m5, 3, 2)));
  console.log(11, c, show(f11(c, m4, 5, 2)), show(f11(c, m5, 3, 2)));
  console.log(12, c, show(f12(c, m4, 5, 2)), show(f12(c, m5, 3, 2)));
  console.log(13, c, show(f13(c, m4, 5, 2)), show(f13(c, m5, 3, 2)));
  console.log(14, c, show(f14(c, m4, 5, 2)), show(f14(c, m5, 3, 2)));
  console.log(15, c, show(f15(c, m4, 5, 2)), show(f15(c, m5, 3, 2)));
  console.log(16, c, show(f16(c, m4, 5, 2)), show(f16(c, m5, 3, 2)));
  console.log(17, c, show(f17(c, m4, 5, 2)), show(f17(c, m5, 3, 2)));
  console.log(18, c, show(f18(c, m4, 5, 2)), show(f18(c, m5, 3, 2)));
  console.log(19, c, show(f19(c, m4, 5, 2)), show(f19(c, m5, 3, 2)));
  console.log(20, c, show(f20(c, m4, 5, 2)), show(f20(c, m5, 3, 2)));
  console.log(21, c, show(f21(c, m4, 5, 2)), show(f21(c, m5, 3, 2)));
  console.log(22, c, show(f22(c, m4, 5, 2)), show(f22(c, m5, 3, 2)));
  console.log(23, c, show(f23(c, m4, 5, 2)), show(f23(c, m5, 3, 2)));
  console.log(24, c, show(f24(c, m4, 5, 2)), show(f24(c, m5, 3, 2)));
  console.log(25, c, show(f25(c, m4, 5, 2)), show(f25(c, m5, 3, 2)));
  console.log(26, c, show(f26(c, m4, 5, 2)), show(f26(c, m5, 3, 2)));
  console.log(27, c, show(f27(c, m4, 5, 2)), show(f27(c, m5, 3, 2)));
  console.log(28, c, show(f28(c, m4, 5, 2)), show(f28(c, m5, 3, 2)));
  console.log(29, c, show(f29(c, m4, 5, 2)), show(f29(c, m5, 3, 2)));
  console.log(30, c, show(f30(c, m4, 5, 2)), show(f30(c, m5, 3, 2)));
  console.log(31, c, show(f31(c, m4, 5, 2)), show(f31(c, m5, 3, 2)));
  console.log(32, c, show(f32(c, m4, 5, 2)), show(f32(c, m5, 3, 2)));
  console.log(33, c, show(f33(c, m4, 5, 2)), show(f33(c, m5, 3, 2)));
  console.log(34, c, show(f34(c, m4, 5, 2)), show(f34(c, m5, 3, 2)));
  console.log(35, c, show(f35(c, m4, 5, 2)), show(f35(c, m5, 3, 2)));
  console.log(36, c, show(f36(c, m4, 5, 2)), show(f36(c, m5, 3, 2)));
  console.log(37, c, show(f37(c, m4, 5, 2)), show(f37(c, m5, 3, 2)));
  console.log(38, c, show(f38(c, m4, 5, 2)), show(f38(c, m5, 3, 2)));
  console.log(39, c, show(f39(c, m4, 5, 2)), show(f39(c, m5, 3, 2)));
}
