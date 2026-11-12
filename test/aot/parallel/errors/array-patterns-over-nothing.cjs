// An array pattern over undefined, null and what is not iterable, outside loops and in them, in a declaration, an assignment and a parameter: what is thrown, with the text that it quotes, and what was done in front of it.
const out = [];
function t(f) { try { out.push(String(f())); } catch (e) { out.push(e.name + ":" + e.message); } }
const un = v => [v][JSON.parse("0")];
let nothing;
function two(x) { const [a, b] = x; return a + "," + b; }
function one(x) { const [a] = x; return a; }
function assigned(x) { let a, b; [a, b] = x; return a + "," + b; }
function given([a, b]) { return a + "," + b; }
function inLoop(xs) { let s = ""; for (let i = 0; i < xs.length; i++) { const [a, b] = xs[i]; s += a + "" + b + ";"; } return s; }
function after(log, x) { log.push("in front"); const [a, b] = x; log.push("behind"); return a + b; }
for (const x of [nothing, null, 5, true, {}, "ab", [1, 2], new Set([3, 4]), [7]]) {
  t(() => two(un(x)));
  t(() => one(un(x)));
  t(() => assigned(un(x)));
  t(() => given(un(x)));
}
t(() => inLoop([[1, 2], "cd"]));
t(() => inLoop([[1, 2], un(nothing), [3, 4]]));
t(() => inLoop([un(null)]));
const log = [];
t(() => after(log, un(nothing)));
t(() => after(log, [1, 2]));
out.push(log.join());
console.log(out.join("|"));
