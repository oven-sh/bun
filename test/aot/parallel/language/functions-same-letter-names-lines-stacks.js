// functions whose bodies are the same to the letter: the frames of an error must still name the one that ran, at its own line
const frames = e => e.stack.split("\n").slice(1, 4).map(l => l.trim().replace(/\(?[^ (]*[\/\\]([^\/\\:]+:\d+:\d+)\)?$/, "$1")).join(" | ");
function alpha(x) { if (x > 1) throw new Error("boom"); return x + 1; }
function beta(x) { if (x > 1) throw new Error("boom"); return x + 1; }
function gamma(x) { if (x > 1) throw new Error("boom"); return x + 1; }
const table = { one(x) { if (x > 1) throw new Error("boom"); return x + 1; }, two(x) { if (x > 1) throw new Error("boom"); return x + 1; } };
class K { m(x) { if (x > 1) throw new Error("boom"); return x + 1; } n(x) { if (x > 1) throw new Error("boom"); return x + 1; } static s(x) { if (x > 1) throw new Error("boom"); return x + 1; } }
const arrows = [x => { if (x > 1) throw new Error("boom"); return x + 1; }, x => { if (x > 1) throw new Error("boom"); return x + 1; }];
const k = new K();
for (const [n, f] of [["alpha", alpha], ["beta", beta], ["gamma", gamma], ["one", table.one], ["two", table.two], ["m", k.m], ["n", k.n], ["s", K.s], ["arrow0", arrows[0]], ["arrow1", arrows[1]]]) {
  try { f(2); } catch (e) { console.log(n, "|", f.name, f.length, "|", frames(e)); }
}
console.log(alpha === beta, alpha.toString() === beta.toString().replace("beta", "alpha"), new Set([alpha, beta, gamma, table.one, table.two]).size);
alpha.mark = 1; console.log(beta.mark, gamma.mark, alpha.prototype === beta.prototype);
