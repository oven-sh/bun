let junk: unknown[] = [];
function churn(n: number) { for (let i = 0; i < 2000; i++) junk.push({ i, text: "t" + i, list: [i, i + 1] }); if (junk.length > 20000) { junk = []; if (n % 7 === 0) Bun.gc(true); } }
class Box { constructor(readonly n: number, readonly text: string) {} }
async function leaf(n: number) { const own = new Box(n, "leaf" + n); await n; churn(n); await own; return own; }
async function middle(n: number) { const a = new Box(n, "a" + n); const b = [a, { n }]; const c = await leaf(n); churn(n); const d = await leaf(n + 1); return a.text + (b[1] as { n: number }).n + c.text + d.n; }
async function main() {
  await 0;
  let sum = 0;
  for (let i = 0; i < 400; i++) { const label = "x" + i; const r = await middle(i); sum = (sum * 31 + r.length + label.length) % 1000003; if (i % 100 === 0) console.log(label, r, sum); }
  console.log(sum);
}
await main();
let sum = 0;
for (let i = 0; i < 100; i++) { const r = await middle(i); sum = (sum * 31 + r.length) % 1000003; }
console.log(sum);
