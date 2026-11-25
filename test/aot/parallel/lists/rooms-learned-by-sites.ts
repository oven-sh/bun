// Empty literals whose sites have learned rooms of one to twenty-five: what stands behind the length, what grows past the room, lists with holes, lists kept while others are collected.
declare const Bun: any;
const words: string[] = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split(" ");
const kept: any[][] = [];
function seen(t: any[], n: number): string { let s = t.length + (n in t ? "!" : "") + (t[n] === undefined ? "" : "?") + t.at(-1) + t.indexOf(words[3]); t.length = n + 3; s += Object.keys(t).length + "," + t.lastIndexOf(undefined); t[n + 1] = words[n % 24]; s += t.includes(undefined) + "," + t.join("").length; t.push(1, 2.5, null); s += t.length + Object.keys(t).length; return s; }
function written1(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 1; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 1); } return s; }
function unwritten1(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 1; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 1); } return s; }
function written2(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 2; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 2); } return s; }
function unwritten2(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 2; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 2); } return s; }
function written4(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 4; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 4); } return s; }
function unwritten4(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 4; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 4); } return s; }
function written6(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 6; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 6); } return s; }
function unwritten6(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 6; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 6); } return s; }
function written7(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 7; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 7); } return s; }
function unwritten7(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 7; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 7); } return s; }
function written8(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 8; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 8); } return s; }
function unwritten8(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 8; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 8); } return s; }
function written9(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 9; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 9); } return s; }
function unwritten9(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 9; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 9); } return s; }
function written10(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 10; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 10); } return s; }
function unwritten10(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 10; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 10); } return s; }
function written12(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 12; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 12); } return s; }
function unwritten12(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 12; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 12); } return s; }
function written13(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 13; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 13); } return s; }
function unwritten13(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 13; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 13); } return s; }
function written14(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 14; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 14); } return s; }
function unwritten14(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 14; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 14); } return s; }
function written16(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 16; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 16); } return s; }
function unwritten16(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 16; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 16); } return s; }
function written17(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 17; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 17); } return s; }
function unwritten17(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 17; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 17); } return s; }
function written18(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 18; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 18); } return s; }
function unwritten18(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 18; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 18); } return s; }
function written22(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 22; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 22); } return s; }
function unwritten22(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 22; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 22); } return s; }
function written25(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 25; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 25); } return s; }
function unwritten25(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 25; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 25); } return s; }
function written30(n: number): string { let s = ""; for (let i = 0; i < n; i++) { const t: string[] = []; for (let k = 0; k < 30; k++) t.push(words[(i + k) % 24]); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 30); } return s; }
function unwritten30(n: number, of: any): string { let s = ""; for (let i = 0; i < n; i++) { const t = []; for (let k = 0; k < 30; k++) t.push(of(i + k)); if (i % 97 === 0) kept.push(t); if (i % 150 === 149) s += seen(t, 30); } return s; }
function mixed(n: number): string { let s = 0; const groups: Record<string, string[]> = {}; for (let i = 0; i < n; i++) { const t: string[] = []; const k = [7, 2, 5, 2, 4, 1, 1, 30, 2, 2, 18, 1, 1, 2, 1, 3][(i * 7) & 15]; for (let j = 0; j < k; j++) t.push(words[j % 24]); s += t.length; (groups[words[i % 24][0] + (i >> 6)] ||= []).push(words[i % 24]); } return s + Object.values(groups).map(g => g.length).join(""); }
console.log(1, written1(600), unwritten1(600, (i: number) => words[i % 24]), unwritten1(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(2, written2(600), unwritten2(600, (i: number) => words[i % 24]), unwritten2(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(4, written4(600), unwritten4(600, (i: number) => words[i % 24]), unwritten4(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(6, written6(600), unwritten6(600, (i: number) => words[i % 24]), unwritten6(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(7, written7(600), unwritten7(600, (i: number) => words[i % 24]), unwritten7(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(8, written8(600), unwritten8(600, (i: number) => words[i % 24]), unwritten8(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(9, written9(600), unwritten9(600, (i: number) => words[i % 24]), unwritten9(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(10, written10(600), unwritten10(600, (i: number) => words[i % 24]), unwritten10(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(12, written12(600), unwritten12(600, (i: number) => words[i % 24]), unwritten12(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(13, written13(600), unwritten13(600, (i: number) => words[i % 24]), unwritten13(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(14, written14(600), unwritten14(600, (i: number) => words[i % 24]), unwritten14(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(16, written16(600), unwritten16(600, (i: number) => words[i % 24]), unwritten16(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(17, written17(600), unwritten17(600, (i: number) => words[i % 24]), unwritten17(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(18, written18(600), unwritten18(600, (i: number) => words[i % 24]), unwritten18(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(22, written22(600), unwritten22(600, (i: number) => words[i % 24]), unwritten22(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(25, written25(600), unwritten25(600, (i: number) => words[i % 24]), unwritten25(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(30, written30(600), unwritten30(600, (i: number) => words[i % 24]), unwritten30(300, (i: number) => i & 3 ? i : words[i % 24]));
console.log(mixed(3000).slice(0, 200));
if (typeof Bun === "object") Bun.gc(true);
let sum = 0; for (const t of kept) { sum += t.length; for (let i = 0; i < t.length; i++) sum = (sum * 31 + String(t[i]).length + (i in t ? 1 : 0)) % 1000003; }
console.log(kept.length, sum);
