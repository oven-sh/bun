// Characters read in front of counters that a test holds at most at the length, by bracket, charCodeAt, charAt and at; texts that are joined, narrow, wide, cut and empty; counters that are no integers.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : String(v)) + " "; log += "\n"; }
function distance(a: string, b: string): number {
  let previous: number[] = [];
  for (let j = 0; j <= b.length; j++) previous.push(j);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) { const cost = a[i - 1] === b[j - 1] ? 0 : 1; current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)); }
    previous = current;
  }
  return previous[b.length];
}
function longest(a: string, b: string): number {
  const rows: number[][] = [new Array(b.length + 1).fill(0)];
  for (let i = 1; i <= a.length; i++) { const row = [0]; for (let j = 1; j <= b.length; j++) row.push(a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], row[j - 1])); rows.push(row); }
  return rows[a.length][b.length];
}
function reversed(a: string): string { let t = ""; for (let i = a.length; i > 0; i--) t += a[i - 1]; return t; }
function pairs(a: string): number { let t = 0; for (let i = 2; i <= a.length; i++) if (a[i - 2] === a[i - 1]) t++; return t; }
function outside(a: string, n: any): string { let t = ""; for (let i = n; i <= a.length; i++) t += a[i - 1] + "," + a.charAt(i - 1) + "," + a.charCodeAt(i - 1) + "," + a.at(i - 1) + ";"; return t; }
function behind(a: string): string { let t = ""; for (let i = 0; i <= a.length; i++) t += a[i] + a[i + 1] + a[i - 3]; return t; }
function changed(a: string, other: string): string { let t = "", text = a; for (let i = 1; i <= text.length; i++) { t += text[i - 1]; if (i === 2) text = other; t += text[i - 1]; } return t; }
function steps(a: string): string { let t = ""; for (let i = 3; i <= a.length; i += 3) t += a[i - 1] + a[i - 2] + a[i - 3]; return t; }
function under(a: string, i: number): string { if (i <= a.length) return a[i - 1] + a[i - 2] + a[i - 4]; return "over"; }
function other(a: string, b: string, i: number): string { let t = ""; for (let k = 0; k < 3; k++) if (i <= a.length) t += b[i - 1]; return t; }
function kept(a: string, n: number): number { let t = 0; for (let i = 1; i <= a.length; i++) for (let k = 0; k < n; k++) if (a[i - 1] === "a") t += k; return t; }
function unchanging(a: string, i: number, n: number): number { let t = 0; for (let k = 0; k < n; k++) t += a.charCodeAt(i) + k; return t; }
function growing(a: string): string { let t = a; for (let i = 1; i <= t.length && i < 12; i++) { t += t[i - 1]; } return t; }
const wide = "grün€ß", texts = ["", "a", "kitten", "sitting", "a".repeat(5) + "b", wide, wide + "x", "x" + wide.slice(1, 4), "abcdef".slice(1, 5), ["q", "w", "e"].join("")];
for (let round = 0; round < 4; round++) {
  let joined = "start"; for (let i = 0; i < 5; i++) joined += "ab" + round;
  for (const a of [...texts, joined]) {
    show(reversed(a), pairs(a), behind(a), steps(a), kept(a, 3), growing(a), changed(a, "zz"), changed(a, ""), unchanging(a, 0, 3), unchanging(a, 2, 3), unchanging(a, -1, 2), unchanging(a, 0.5, 2));
    for (const b of texts) show(distance(a, b), longest(a, b), other(a, b, 1), other(a, b, 3));
    for (const n of [1, 0, -2, 0.5, 1.5, "1", "2", NaN, undefined, null, true, { valueOf: () => 1 }, -0, 3]) show(outside(a, n), typeof n === "number" ? under(a, n) : "");
  }
}
console.log(log.length, log);
