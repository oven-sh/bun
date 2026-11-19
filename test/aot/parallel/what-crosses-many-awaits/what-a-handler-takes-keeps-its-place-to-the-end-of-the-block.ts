// Words of the machine frame whose lives are apart share one place.
// A throw anywhere in a block hands the handler its arguments out of their words.
const mk = (n: number) => { if (n < 0) throw "t"; return JSON.parse('{"v":' + n + "}"); };
async function f(p: any, bad: any, mk: any, a: any, b: any, c: any, d: any, e: any) {
  let out = "";
  for (let i = 0; i < 3; ++i) {
    let seen = mk(i + 50), q: any, r: any, s: any, t: any;
    await p; await p; await p; await p; await p; await p; 
    try {
      await (i === 1 ? bad : p); await p; seen = mk(i + 70); await p; await p; await p; await p; await p; await p; 
      q = mk(i + 10); r = mk(i + 20); s = mk(i + 30); t = mk(i + 40); mk(1 - i);
    } catch (error) { out += "c" + seen.v; await p; await p; out += error; continue; }
    await p; await p; await p; await p; await p; await p; 
    out += "n" + q.v + r.v + s.v + t.v;
  }
  return out + a + b + c + d + e;
}
const bad = Promise.reject("b"); bad.catch(() => {});
console.log(await f(Promise.resolve(0), bad, mk, 1, 2, 3, 4, 5));
export {};
