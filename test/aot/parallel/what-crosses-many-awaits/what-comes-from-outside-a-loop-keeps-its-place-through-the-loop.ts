// Words of the machine frame whose lives are apart share one place.
// A loop that only reads a value counts whole in its life.
const mk = (n: number) => { if (n < 0) throw "t"; return JSON.parse('{"v":' + n + "}"); };
async function f(p: any, mk: any, a: any, b: any, c: any, d: any, e: any) {
  let s = "", k = 0, w: any, x: any, y: any, z: any;
  { const o = mk(a); do { s += o.v; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; w = mk(k + 10); x = mk(k + 20); y = mk(k + 30); z = mk(k + 40); } while (++k < 3); }
  await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; await p; 
  return s + w.v + x.v + y.v + z.v + a + b + c + d + e;
}
console.log(await f(Promise.resolve(0), mk, 1, 2, 3, 4, 5));
export {};
