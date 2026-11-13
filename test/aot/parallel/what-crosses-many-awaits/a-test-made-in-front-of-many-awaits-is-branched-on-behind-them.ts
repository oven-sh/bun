// Words of the machine frame whose lives are apart share one place.
// What a branch alone reads is read back out of its word too.
async function f(p: Promise<number>, a: number, b: number): Promise<string> {
  const big = a > b;
  const v0 = await p;
  const v1 = await p;
  const v2 = await p;
  const v3 = await p;
  const v4 = await p;
  const v5 = await p;
  const v6 = await p;
  const v7 = await p;
  const v8 = await p;
  const v9 = await p;
  const v10 = await p;
  const v11 = await p;
  const v12 = await p;
  const v13 = await p;
  const v14 = await p;
  const v15 = await p;
  const v16 = await p;
  const v17 = await p;
  const v18 = await p;
  const v19 = await p;
  const v20 = await p;
  const v21 = await p;
  const v22 = await p;
  const v23 = await p;
  if (big) return "big " + (v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11 + v12 + v13 + v14 + v15 + v16 + v17 + v18 + v19 + v20 + v21 + v22 + v23);
  return "small " + (v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11 + v12 + v13 + v14 + v15 + v16 + v17 + v18 + v19 + v20 + v21 + v22 + v23);
}
for (const [a, b] of JSON.parse("[[2,1],[1,2]]") as [number, number][]) console.log(await f(Promise.resolve(1), a, b));
export {};
