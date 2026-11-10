function fill(a: string, b: string) {
  const out: string[] = [];
  for (let at = 0; at < 150000000; at++) out.push(a + b);
  return out.length;
}
let long = "ab";
for (let turn = 0; turn < 29; turn++) long = long + long;
let said = "none";
try { fill(long, long); } catch (e) { said = (e as Error).name; }
console.log(said, process.memoryUsage().rss > 800000000);
