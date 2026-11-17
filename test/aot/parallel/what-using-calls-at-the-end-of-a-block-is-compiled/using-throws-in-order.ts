// what `using` throws, in which order, with which lines
const log: any[] = [];
const frames = (error: any): string => error.stack.split("\n").slice(1).map((line: string) => /at (?:new |\w+\.)?([\w.\[\]]+) .*?:(\d+):\d+\)?$/.exec(line.trim())).filter((m: any) => m).map((m: any) => m[1] + ":" + m[2]).slice(0, 3).join(">");
// An error of a disposal has no line of its own.
const placed = (error: any): string => error.name === "TypeError" && !error.message.startsWith("Cannot call") ? frames(error) : "";
class Plain { n = 1; }
class Own { constructor(public n: number) {} [Symbol.dispose]() { log.push("own" + this.n); } }
class Getter { get [Symbol.dispose](): any { log.push("get"); return () => { log.push("got"); }; } }
class Bad { [Symbol.dispose]: any = 5; }
class Nothing { [Symbol.dispose]: any = null; }
class Throws { [Symbol.dispose](): void { throw new RangeError("disposing"); } }
class GetterThrows { get [Symbol.dispose](): any { throw new SyntaxError("getter"); } }
const proxy = new Proxy({}, { get(t: any, k: any) { log.push(String(k)); return k === Symbol.dispose ? () => { log.push("proxy"); } : undefined; } });
const values: any[] = [null, undefined, 1, "a", true, Symbol("s"), 5n, {}, [], () => {}, new Plain(), new Own(3), new Getter(), new Bad(), new Nothing(), new Throws(), new GetterThrows(), proxy, { [Symbol.dispose]() { log.push(this === values[18]); } }, { [Symbol.dispose]: Own }, Object.assign(() => 1, { [Symbol.dispose]() { log.push("fn"); } }), { __proto__: new Own(9), n: 8 }, { [Symbol.dispose]: undefined }, { [Symbol.dispose]: async () => { log.push("async"); } }];
function one(v: any): any {
  using r = v;
  log.push("body");
  return typeof r;
}
function two(v: any, w: any): any {
  using r = v, q = w;
  log.push("body");
  if (log.length > 400) throw new Error("body");
  return 2;
}
function loop(v: any): any {
  let k = 0;
  for (using r of [v, new Own(1), v]) {
    k++;
    if (k === 2) continue;
  }
  return k;
}
function head(v: any): any {
  for (using r = v; ;) {
    log.push("head");
    break;
  }
  return 1;
}
function inner(v: any): any {
  let t = 0;
  for (let i = 0; i < 3; i++) {
    using r = v;
    t += i;
    if (i === 1) break;
  }
  return t;
}
function thrown(v: any): any {
  using r = v;
  throw new Error("thrown");
}
for (let turn = 0; turn < 3; turn++) {
  for (let i = 0; i < values.length; i++) {
    for (const f of [one, loop, head, inner, thrown]) {
      try { console.log(i, f.name, f(values[i]), log.splice(0).join()); } catch (error: any) { console.log(i, f.name, error.name, error.message, error.error?.name, error.suppressed?.name, log.splice(0).join(), placed(error)); }
    }
    for (const w of [values[11], values[2], values[15], null]) {
      try { console.log(i, two(values[i], w), log.splice(0).join()); } catch (error: any) { console.log(i, error.name, error.message, error.error?.name, error.suppressed?.name, log.splice(0).join(), placed(error)); }
    }
  }
}
let sum = 0;
for (let i = 0; i < 300; i++) { using r = new Own(i & 3); sum += r.n; if (i === 100) Own.prototype[Symbol.dispose] = function () { log.push("other"); }; }
console.log(sum, log.length, log.slice(95, 106).join());
