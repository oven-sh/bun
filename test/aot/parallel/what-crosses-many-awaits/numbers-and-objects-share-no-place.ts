// Words of the machine frame whose lives are apart share one place.
// A place that the collector traces holds no raw number.
async function f(p: any, a: any, b: any, c: any, d: any, e: any) {
  let out = "";
  for (let i = 0; i < 2; ++i) {
    const n = (((await p) | 0) + i) | 0; await p; await p; await p; await p; await p; await p; out += n;
    const q = (await p) / -4; await p; await p; await p; await p; await p; await p; Bun.gc(true); out += " " + q;
    const z = (n - n) * -1; await p; await p; await p; await p; await p; await p; out += " " + 1 / z;
    const w = (n & 1) === 1; await p; await p; await p; await p; await p; await p; Bun.gc(true); out += " " + w + ";";
  }
  return out + a + b + c + d + e;
}
console.log(await f(Promise.resolve(6), 1, 2, 3, 4, 5));
export {};
