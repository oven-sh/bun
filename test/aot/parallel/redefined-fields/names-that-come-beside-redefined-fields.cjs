// A name that was absent beside a field outside its slot comes into its slot, outside it and above.
globalThis.kept = new Function("f", "return f" + (process.argv.length > 100 ? 1 : ""))(Object);
function merge(visitors) {
  const merged = { _verified: true, _exploded: true };
  Object.defineProperty(merged, "_exploded", { enumerable: false });
  Object.defineProperty(merged, "_verified", { enumerable: false });
  for (const visitor of visitors) for (const key of Object.keys(visitor)) (merged[key] || (merged[key] = [])).push(visitor[key]);
  return merged;
}
exports.hide = function hide(merged) { merged.noScope = true; return merged; };
class Options { constructor(noScope) { this.noScope = noScope; this.enter = null; } }
exports.plain = [new Options(0), { noScope: 1, exit: 2 }, { enter: 1, noScope: 0, exit: 3 }];
const visitors = [];
for (let k = 0; k < 3; k++) { const visitor = {}; for (let at = 0; at < 20 + k; at++) visitor["Type" + (at * (k + 1))] = at; visitors.push(visitor); }
exports.isScoped = function (opts) { if (opts != null && opts.noScope) return 0; return 1; };
exports.verified = function (opts) { return opts._verified ? 1 : 0; };
const all = [merge(visitors), merge(visitors.slice(1)), merge([visitors[0]])];
const f = exports[process.argv[9] || "isScoped"], N = +(process.argv[10] || 40000);
let n = 0;
for (let round = 0; round < 3; round++) { const o = all[round]; for (let k = 0; k < N; k++) n += f(o); }
console.log(n, Object.keys(all[0]).length, exports.verified(all[0]), exports.plain.map(f).join());
// The name comes: into its slot, outside its slot, above.
const late = all[0];
exports.hide(late);
console.log(f(late), f(all[1]), Object.keys(late).slice(-1)[0]);
delete late.noScope;
console.log(f(late));
Object.defineProperty(late, "noScope", { get() { return 1; }, configurable: true, enumerable: true });
console.log(f(late), f(all[1]));
Object.defineProperty(all[1], "noScope", { value: 2, enumerable: false, configurable: true });
console.log(f(all[1]), f(all[2]), JSON.stringify(Object.getOwnPropertyDescriptor(all[1], "noScope")));
delete all[1].noScope;
console.log(f(all[1]));
Object.setPrototypeOf(all[2], { noScope: "above" });
console.log(f(all[2]), f(all[1]));
all[2].noScope = 0;
console.log(f(all[2]));
const frozen = Object.freeze(merge(visitors));
console.log(f(frozen), exports.verified(frozen));
Object.setPrototypeOf(frozen.constructor === Object ? all[1] : frozen, null);
console.log(f(all[1]), f(frozen));
