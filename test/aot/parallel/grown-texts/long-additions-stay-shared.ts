// Texts that grow by long texts which they share with other texts: nobody reads a character, so nothing is copied.
function stored(a: any, b: any): any { let s = ""; for (let i = a.length - 1; i >= 0; --i) { b[i * 2] = s; s += "x"; s += a[i]; } return s; }
function storedNumber(a: any, b: any): any { let s: any = 0; for (let i = a.length - 1; i >= 0; --i) { b[i * 2] = s; s += "x"; s += a[i]; } return s; }
function storedByTemplate(a: any, b: any): any { let s = ""; for (let i = a.length - 1; i >= 0; --i) { b[i * 2] = s; s = `${s}x${a[i]}`; } return s; }
function grown(list: string[], piece: string, times: number): number { let s = ""; for (let i = 0; i < times; i++) { s += piece; s += ","; list[0] = s; } return s.length; }
function shortAfterLong(list: string[], piece: string): number { let s = ""; for (let i = 0; i < 2000; i++) s += "ab"; s += piece; for (let i = 0; i < 4000; i++) { s += "cd"; list[0] = s; } return s.length + s.charCodeAt(3999) + s.charCodeAt(s.length - 1); }
for (const f of [stored, storedNumber, storedByTemplate]) {
  const a: any[] = Array.from({ length: 300 }, (_, q) => q * 2 + 0.5);
  let r = 0;
  try { for (; r < 6; r++) console.log(r, f(a, a).length); } catch (e) { console.log("threw", r, (e as Error).name); }
}
const kept: string[] = [], long = "0123456789".repeat(100_000);
console.log(grown(kept, long, 1500), kept[0]!.length, shortAfterLong(kept, long));
const megabytes = process.memoryUsage().rss / 1e6;
console.log(megabytes < 800 ? "light" : `${Math.round(megabytes)} MB`);
