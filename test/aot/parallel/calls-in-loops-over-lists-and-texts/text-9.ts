const seen: any[] = [];
let total = 0;
let target: any = "abc";
function quiet(code: number): boolean { let low = 0, high = 20; while (low < high) { const middle = (low + high) >> 1; if (middle * 10 < code) low = middle + 1; else high = middle; } return low > 10; }
function noisy(x: any): number { total += String(x).length; target = target + x; return total % 5; }
function thrower(code: number): number { if (code === 119 || code > 60000) throw new Error("at " + code); return code & 7; }
function counter(code: number): number { total += code; return total & 3; }
function shadow(code: number, x: any): any { if (typeof x === "object" && x) x.extra = code; return code % 7; }
function later(x: any): any { if (total > 500) (Array.isArray(shared) && shared.length < 30) && shared.push("p"); return x; }
const shared: any[] = ["q", "w", "o", "\u{1f600}"];
const method = { limit: 105, hits: 0, run(code: number): number { this.hits++; return code > this.limit ? this.hits : 0; } };
let closure: any = (x: any) => (total++, x === "o" ? 7 : 0);
const fields: any[] = [(x: any) => 1, (x: any) => { total += 2; return 0; }, (x: any) => x];
class Own { closed = 0; *[Symbol.iterator]() { try { yield "a"; yield "w"; yield "o"; } finally { this.closed++; } } }
const own = new Own();
function walk(text: Iterable<string>): any {
  let n = 0;
  
  for (const x of text) {
    const code = x.codePointAt(0) ?? -1;
    const held990 = () => thrower(code); if (true) n += 1;
    if (code === 111) { closure(x); n++; }
    if (code > 0x2ff) { noisy(x); n++; }
    seen.push(String([...x].length));
  }
  return n;
}
const values: any[] = ["the quick brown fox", "", "o", "w\u{1f600}o\ud83d", "lorem " + "ipsum dolor sit amet, consectetur".slice(3), shared, new String("boxed ow"), new Set(["w", "o"]), own, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
for (let i = 0; i < 40; i++) {
  const value = values[i < 20 ? [0, 4, 9, 2][i % 4] : i % values.length];
  seen.length = 0;
  let said: any;
  try { said = walk(value); } catch (error: any) { said = error.name + " " + String(error.message).slice(0, 30); }
  console.log(i, String(said), seen.join("|").slice(0, 120), total, method.hits, own.closed, shared.length, String(target).length);
  total %= 1000; method.hits %= 50; target = String(target).slice(0, 5);
}
export {};
