// Arrays: element kinds change through aliases, computed method names, length, holes, native methods.
const nums = [1, 2, 3, 4];
function total(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
console.log(total(nums));
const method = JSON.parse('"push"');
nums[method]("5");
console.log(total(nums), typeof nums[4]);
const b = [1, 2, 3]; const alias = b; alias[1] = 2.5; console.log(total(b));
alias[5] = 1; console.log(total(b), b.length, 3 in b, b[3]);
const c = [1, 2, 3]; c.length = 1; console.log(total(c), c[1]);
const d = [3, 1, 2]; d.sort((x, y) => { if (d.length < 4) d.push("z"); return x - y; }); console.log(d.join());
const e = [1, 2, 3]; e.fill("f", 1); console.log(total(e));
const f = [1, 2, 3]; Array.prototype.splice.call(f, 1, 1, null, undefined); console.log(total(f), f.length);
const g = [1, 2, 3]; Object.assign(g, ["a"]); console.log(total(g));
const h = [1, 2, 3]; Reflect.set(h, 0, 10n); try { console.log(total(h)); } catch (x) { console.log(x.name); }
const i2 = [1, 2, 3]; i2.copyWithin(0, 1); i2.reverse(); console.log(i2.join());
const j = [1, 2, 3]; const [fn] = [Array.prototype.unshift]; fn.call(j, {}); console.log(total(j));
const k = [0.5, 1.5]; k.push(1); k[0] = -0; console.log(Object.is(k[0], -0), 1 / k[0], total(k));
const big = [1, 2]; big[1] = 2147483648; big[0] = 2 ** 53; console.log(total(big), big[1] | 0);
const m = [1, 2, 3].map(x => x > 1 ? x : "s"); console.log(total(m));
const n = Array.from({ length: 3 }, (_, q) => q ? q : null); console.log(total(n));
const o = [1, 2, 3]; o.foo = 1; let keys = ""; for (const q in o) keys += q; console.log(keys);
const p = [[1], [2]]; p[0].push("x"); console.log(total(p[0]), total(p[1]));
const frozen = Object.freeze([1, 2]); try { "use strict"; frozen.push(3); } catch (x) { console.log(x.name); } console.log(frozen.length);
