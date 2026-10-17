// `Array.from(x)` inside `try`, where `x` was cast before the `try`.
declare const console: any;
const said: string[] = [];
let calls = 0, every = 3;
function churn(x: number, depth: number): number {
  let a = x + 1, b = x + 2, c = x + 3, d = x + 4, e = x + 5, f = x + 6, g = x + 7, h = x + 8, i = x + 9, j = x + 10;
  for (let t = 0; t < 2; t++) { a += b ^ t; b += c & 31; c += d | 1; d += e ^ a; e += f & b; f += g | c; g += h ^ d; h += i & e; i += j | f; j += a ^ g; }
  if (depth) return churn(a & 63, depth - 1) + b + c + d + e + f + g + h + i + j;
  if (x >= 0) throw "thrown";
  return a + b + c + d + e + f + g + h + i + j;
}
function mayThrow(): void { if (every && ++calls % every === 0) churn(calls & 63, 3); }
function copyOf(text: any): string { try { mayThrow(); } catch {} return Array.from(text, (c: any) => c + ".").join(""); }
function plainCopyOf(text: any): string { try { mayThrow(); } catch {} return Array.from(text).join("-"); }
function inTheHandler(text: any): string { try { mayThrow(); return "none"; } catch { return Array.from(text).join("/"); } }
function lengthOf(like: any): number { try { mayThrow(); } catch {} return Array.from(like).length; }
for (const [how, k] of [["never", 0], ["every third", 3], ["every second", 2], ["always", 1]] as [string, number][]) {
  every = k; calls = 0;
  let texts = "", plain = "", handled = "", lengths = 0, arrays = "";
  for (let i = 0; i < 7; i++) {
    texts += copyOf("t" + i + "z") + ";";
    plain += plainCopyOf("ab" + i) + ";";
    handled += inTheHandler("x" + i) + ";";
    lengths += lengthOf({ length: i });
    arrays += plainCopyOf([i, i + 1]) + ";";
  }
  said.push("with a function, " + how + ": " + texts);
  said.push("without, " + how + ": " + plain);
  said.push("in the handler, " + how + ": " + handled);
  said.push("of records, " + how + ": " + lengths);
  said.push("of arrays, " + how + ": " + arrays);
}
console.log(said.join("\n"));
export {};
