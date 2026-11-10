function fill(w: string, n: number) {
  const out: string[] = [];
  for (let at = 0; at < n; at++) {
    const a = w + w, b = a + a, c = b + b, d = c + c, e = d + d;
    out[at] = e + at;
  }
  return out.length;
}
let long = "ab";
for (let turn = 0; turn < 25; turn++) long = long + long;
let said = "none";
try { fill(long, 150000000); } catch (e) { said = (e as Error).name; }
console.log(said, long.length, process.memoryUsage().rss > 800000000);
