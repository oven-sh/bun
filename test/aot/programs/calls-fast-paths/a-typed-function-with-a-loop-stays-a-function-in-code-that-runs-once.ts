// A function with declared types and a loop of its own is called in a loop of the module body, which runs once.
// A loop takes its heat from the function that holds it, so the function is not copied into the module body: the test of `rows` stands in front of its loop.
// Two calls with one argument stay in the module body: of the parser that JSON.parse became, and of count().
// IRM= 2 = CallDirect v[0-9]+ function=f[0-9]+
const rows: { name: string }[] = JSON.parse("[" + Array.from({ length: 48 }, (_, k) => `{"name":"tool_${k * 7}"}`).join(",") + "]");
function count(i: number): number {
  const seen: Record<string, number> = Object.create(null);
  let found = i & 1;
  for (let k = 0; k < rows.length; k++) {
    const key = rows[k]!.name;
    if (seen[key] !== undefined) continue;
    seen[key] = k;
    found++;
  }
  return found;
}
let sum = 0;
for (let round = 0; round < 30; round++) for (let i = 0; i < 100; i++) sum = (sum + count(i)) | 0;
console.log(sum);
