// Strings that are flat, within another string, ropes and of 16 bits, compared with each other and with any other value.

const text = "alpha beta gamma delta epsilon alphabet alpha alphb zeta z zz ~tilde \u00e9t\u00e9 caf\u00e9 0 10 9 A a B b longerwordthaneightcharacters longerwordthaneightcharacterz longerwordthaneight 12345678 123456789 12345679";
const wide = "\u4e2d\u6587 \u4e2d \ud83d\ude00 \ud83d\ude01 alpha \uffff \ue000 \u00ff z";
const parts: any[] = [];
for (const p of text.split(" ")) parts.push(p);
for (const p of wide.split(" ")) parts.push(p);
for (let i = 0; i < text.length; i += 5) parts.push(text.substring(i, i + 1 + i % 13), text.slice(i, i + 9));
for (let i = 0; i < 8; i++) parts.push(parts[i] + parts[i + 1], parts[i] + i, "x" + parts[i + 3] + "y");
parts.push("", "a", "alpha", String(1234), text, wide, text + wide, ("ab".repeat(20) + parts[2]).substring(3, 30), new String("alpha"), 5, "5", null, undefined, true, NaN, 7n, [], ["a"], { toString() { return "gamma"; } }, new Date(0));
let calls = 0;
const out: string[] = [];
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function less(a: any, b: any): boolean { return a < b; }
function lessOrEqual(a: any, b: any): boolean { return a <= b; }
function greater(a: any, b: any): boolean { return a > b; }
function greaterOrEqual(a: any, b: any): boolean { return a >= b; }
for (const a of parts) { let row = ""; for (const b of parts) row += (less(a, b) ? 1 : 0) + (lessOrEqual(a, b) ? 2 : 0) + (greater(a, b) ? 4 : 0) + (greaterOrEqual(a, b) ? 8 : 0) + ","; out.push(hash(row) + ":" + row.substring(0, 40)); }
console.log(out.join("\n"));
