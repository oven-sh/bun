// flatMap, findLast, findLastIndex and reduceRight over lists with holes, accessors, species, proxies, and lists that change under them.
const say = [], t = f => { try { say.push(String(f())); } catch (e) { say.push(e.name); } };
for (let round = 0; round < 3; round++) {
  const log = [], a = [1, , 3]; Object.defineProperty(a, 3, { get() { log.push("g3"); return [7, 8]; }, enumerable: true, configurable: true });
  t(() => a.flatMap((x, i) => { log.push(i); return Array.isArray(x) ? x : [x, [x]]; }).map(String).join() + log.join());
  const b = [1, 2, 3]; t(() => b.flatMap((x, i, l) => { if (i === 0) { l.push(9); l[1] = 0.5; } return i === 1 ? [x, , 5] : x; }).join() + b.length);
  class S extends Array {} const s = S.from([1, 2]).flatMap(x => [x, x]); t(() => `${s instanceof S} ${s.length} ${s.join()}`);
  const c = [1]; c.constructor = { [Symbol.species]: function (n) { return { n }; } }; t(() => JSON.stringify(c.flatMap(x => [x, x + 1])));
  const e = [1, 2, 3]; e.constructor = { [Symbol.species]: function () { return e; } }; t(() => `${e.flatMap(x => [x, x]) === e} ${e.join()}`);
  let n = 0; t(() => [1, 2, 3, 4, 5].flatMap((x, i) => { n++; if (i === 3) throw new RangeError("r"); return x; })); say.push(n);
  let m = 0; const f = [1, 2]; f.constructor = { [Symbol.species]: function () { return Object.freeze([]); } }; t(() => f.flatMap(x => (m++, x))); say.push(m);
  const r = Proxy.revocable([], {}); r.revoke(); let k = 0; t(() => [1, 2].flatMap(() => (k++, r.proxy))); say.push(k);
  t(() => [1].flatMap(() => new Proxy([5, 6], {})).join()); t(() => Array.prototype.flatMap.call({ length: 3, 0: "a", 2: ["b"] }, x => x).join()); t(() => [1, 2, 3].flatMap(function (x) { return x * this.by; }, { by: 2 }).join());
  t(() => [0.5, "s", null, { a: 1 }, [1, [2]], [], [0.25, 0.5], [-0]].flatMap(x => x).map(x => Object.is(x, -0) ? "-0" : String(x)).join("|"));
  const big = []; for (let i = 0; i < 300; i++) big.push(i % 3 ? i : i / 2); t(() => { const o = big.flatMap(x => [x, [x], x + 0.5]); return o.length + " " + o[7] + " " + o[898]; });
  t(() => [1, , 3, 4].findLast(x => x === undefined)); t(() => [1, , 3].findLastIndex(x => x === undefined)); t(() => [1, , 3, 4].reduceRight((p, x, i) => p + "" + x + i));
  t(() => [1, 2, 3, 4].findLast((x, i, l) => { if (i === 3) l.length = 1; return x === undefined; })); t(() => [1, 2, 3, 4].reduceRight((p, x, i, l) => { if (i === 3) l.length = 2; return p + x; }, 0)); t(() => [].reduceRight((p, x) => p)); t(() => [, ,].reduceRight((p, x) => p)); t(() => [0.5, 1.5, -0].reduceRight((p, x) => p + "," + x, ""));
  t(() => big.findLast(x => x < 0)); t(() => big.findLastIndex(x => x === 1)); t(() => big.reduceRight((p, x) => p + x, 0));
}
console.log(say.join("\n"));
