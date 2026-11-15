// Words of the machine frame whose lives are apart share one place.
// A sum that waits for its box takes no word.
async function f(x: number, y: number, p: Promise<number>): Promise<number[]> {
  const s = x + y;
  const a0 = await p;
  const a1 = await p;
  const a2 = await p;
  const a3 = await p;
  const a4 = await p;
  const a5 = await p;
  const a6 = await p;
  const a7 = await p;
  const a8 = await p;
  const a9 = await p;
  const a10 = await p;
  const a11 = await p;
  const a12 = await p;
  const a13 = await p;
  const a14 = await p;
  const a15 = await p;
  const a16 = await p;
  const a17 = await p;
  const a18 = await p;
  const a19 = await p;
  const a20 = await p;
  const a21 = await p;
  const a22 = await p;
  const a23 = await p;
  return [s, a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23];
}
for (const [x, y] of JSON.parse("[[1,2],[1.5,2.25]]") as [number, number][]) { const r = await f(x, y, Promise.resolve(7)); console.log(r[0], r.length, r[24]); }
export {};
