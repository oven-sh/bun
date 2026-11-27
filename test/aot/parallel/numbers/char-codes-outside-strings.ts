// charCodeAt() gives a code unit, or NaN outside of its string: through results, fields, arrays, captured variables and conversions.
const texts = ["", "a", "09", "é中", "😀", "x".repeat(9), ["p", "q"].join("-"), "pre" + String(12)];
const raw = (s: string, i: number): number => s.charCodeAt(i);
const number = (s: string, at: number): number => { let v = 0; while (s.charCodeAt(at) >= 48 && s.charCodeAt(at) <= 57) v = v * 10 + s.charCodeAt(at++) - 48; return v * 100 + at; };
const hash = (s: string, i: number): number => { let h = 5381; for (let k = 0; k <= s.length; k++) h = ((h << 5) + h + s.charCodeAt(k + i)) | 0; return h; };
const total = (s: string, i: number): number => { let sum = 0; for (let k = 0; k < 4; k++) sum += s.charCodeAt(i + k); return sum; };
const kind = (s: string, i: number): string => { switch (s.charCodeAt(i)) { case 97: return "a"; case 48: return "zero"; case 0x4e2d: return "wide"; default: return "other"; } };
class Lexer { at = 0; private code: number; constructor(private readonly s: string) { this.code = s.charCodeAt(0); } step(): number { const was = this.code; this.code = this.s.charCodeAt(++this.at); return was; } get done(): boolean { return isNaN(this.code); } }
for (const s of texts) {
  for (const i of [0, 1, 5, -1, 0.5, NaN, 4294967296]) { let held = raw(s, i); const add = (): number => ++held; const list = [raw(s, i), raw(s, i + 1)]; console.log(JSON.stringify(s), i, raw(s, i), raw(s, i) | 0, raw(s, i) >>> 1, -raw(s, i), raw(s, i) % 10, Math.max(raw(s, i), 50), kind(s, i), raw(s, i) ? "t" : "f", add(), held, JSON.stringify(list), list[0]! + list[1]!, new Set(list).size, total(s, i)); }
  const lexer = new Lexer(s); const steps: number[] = []; while (!lexer.done) steps.push(lexer.step());
  console.log(steps.join(), lexer.step(), number(s, 0), number(s, 1), hash(s, 0), hash(s, 3));
}
export {};
