// a list of records, twelve levels of types below it; the two lowest levels are written whole
type L12 = { a12: number; b12: number; c12: number; d12: number; e12: number; f12: number; };
type L11 = { a11: L12; b11: L12; c11: L12; d11: L12; e11: L12; f11: L12; };
type L10 = { a10: L11; b10: L11; c10: L11; d10: L11; e10: L11; f10: L11; };
type L9 = { a9: L10; b9: L10; c9: L10; d9: L10; e9: L10; f9: L10; };
type L8 = { a8: L9; b8: L9; c8: L9; d8: L9; e8: L9; f8: L9; };
type L7 = { a7: L8; b7: L8; c7: L8; d7: L8; e7: L8; f7: L8; };
type L6 = { a6: L7; b6: L7; c6: L7; d6: L7; e6: L7; f6: L7; };
type L5 = { a5: L6; b5: L6; c5: L6; d5: L6; e5: L6; f5: L6; };
type L4 = { a4: L5; b4: L5; c4: L5; d4: L5; e4: L5; f4: L5; };
type L3 = { a3: L4; b3: L4; c3: L4; d3: L4; e3: L4; f3: L4; };
type L2 = { a2: L3; b2: L3; c2: L3; d2: L3; e2: L3; f2: L3; };
type L1 = { a1: L2; b1: L2; c1: L2; d1: L2; e1: L2; f1: L2; };
type L0 = { a0: L1; b0: L1; c0: L1; d0: L1; e0: L1; f0: L1; };
const v12: L12 = { a12: 1, b12: 2, c12: 3, d12: 4, e12: 5, f12: 6 };
const v11: L11 = { a11: v12, b11: v12, c11: v12, d11: v12, e11: v12, f11: v12 };
const v10: L10 = { a10: v11, b10: v11, c10: v11, d10: v11, e10: v11, f10: v11 };
const v9: L9 = { a9: v10, b9: v10, c9: v10, d9: v10, e9: v10, f9: v10 };
const v8: L8 = { a8: v9, b8: v9, c8: v9, d8: v9, e8: v9, f8: v9 };
const v7: L7 = { a7: v8, b7: v8, c7: v8, d7: v8, e7: v8, f7: v8 };
const v6: L6 = { a6: v7, b6: v7, c6: v7, d6: v7, e6: v7, f6: v7 };
const v5: L5 = { a5: v6, b5: v6, c5: v6, d5: v6, e5: v6, f5: v6 };
const v4: L4 = { a4: v5, b4: v5, c4: v5, d4: v5, e4: v5, f4: v5 };
const v3: L3 = { a3: v4, b3: v4, c3: v4, d3: v4, e3: v4, f3: v4 };
const v2: L2 = { a2: v3, b2: v3, c2: v3, d2: v3, e2: v3, f2: v3 };
const v1: L1 = { a1: v2, b1: v2, c1: v2, d1: v2, e1: v2, f1: v2 };
const v0: L0 = { a0: v1, b0: v1, c0: v1, d0: v1, e0: v1, f0: v1 };
let out = "";
function sum(text: string): number { let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return h; }
function few(n: number): boolean { let t = 0; for (let i = 0; i < (n & 3); i++) t += i; return t > 99; }
function make(n: number): L0[] { return few(n) ? [v0] : []; }
function send(status: number, value: L0[]): void { out += JSON.stringify(value) + " " + status + "\n"; }
function shape(): void { for (let i = 0; i < 300; i++) send(i, make(i)); }
shape(); shape();
function makeLow(n: number): L10[] { return n & 1 ? [v10] : [v10, v10]; }
function sendLow(status: number, value: L10[]): void { out += JSON.stringify(value) + " " + status + "\n"; }
function shapeLow(): void { for (let i = 0; i < 6; i++) sendLow(i, makeLow(i)); }
shapeLow(); shapeLow();
console.log(out.length, sum(out));
console.log(out.slice(0, 240));
