async function down(n: number): Promise<number> {
  await n;
  if (n === 0) return 0;
  return 1 + (await down(n - 1));
}
async function leaf(n: number): Promise<number> { return n; }
async function plainDown(n: number): Promise<number> { return n === 0 ? leaf(7) : 1 + (await plainDown(n - 1)); }
async function tail(n: number): Promise<number> { await 0; return n === 0 ? 0 : tail(n - 1); }
async function main() {
  await 0;
  console.log(await down(100000));
  for (let i = 0; i < 3; i++) console.log(await down(2000 * i));
  console.log(await plainDown(1500));
  console.log(await tail(30000));
  function sync(n: number): number { return n === 0 ? 0 : 1 + sync(n - 1); }
  console.log(sync(5000));
  async function both(n: number): Promise<number> { await 0; if (n === 0) return sync(3000); return both(n - 1).then(x => x, () => -1) as unknown as number; }
  console.log(await both(100));
}
await main();
