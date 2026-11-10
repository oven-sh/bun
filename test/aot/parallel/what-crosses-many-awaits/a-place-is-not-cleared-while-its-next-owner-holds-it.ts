// Words of the machine frame whose lives are apart share one place.
// A dead word is cleared only where nobody else has taken its place.
const mk = (n: number) => { if (n < 0) throw "t"; return JSON.parse('{"v":' + n + "}"); };
async function f(p: any, mk: any, a: any, b: any, c: any, d: any, e: any) {
  let out = "";
  for (let i = 0; i < 2; ++i) {
    const x = mk(i); await p; await p; await p; await p; await p; await p; 
    const y = mk(x.v + 5);
    if (a) { await p; await p; await p; await p; await p; await p; out += "y" + y.v; await p; }
    await p; await p; await p; await p; await p; await p; 
    const z = y.v > 5 ? mk(30) : mk(40);
    await p; await p; await p; await p; await p; await p; 
    out += "z" + z.v;
  }
  return out + a + b + c + d + e;
}
console.log(await f(Promise.resolve(0), mk, 1, 2, 3, 4, 5));
export {};
