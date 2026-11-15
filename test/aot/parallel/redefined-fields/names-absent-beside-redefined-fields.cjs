// COUNTER: operationAOTFillSiteAnswers <= 60
// A name that is absent from objects that hold another field outside its slot is answered at the site.
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
exports.type = function (opts) { return opts.Type0 ? 1 : 0; };
const all = [merge(visitors), merge(visitors.slice(1)), merge([visitors[0]])];
const f = exports[process.argv[9] || "isScoped"], N = +(process.argv[10] || 200000);
let n = 0; for (let round = 0; round < 3; round++) { const o = all[round]; for (let k = 0; k < N; k++) n += f(o); }
console.log(n);
