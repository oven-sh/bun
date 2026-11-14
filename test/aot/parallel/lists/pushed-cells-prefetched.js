// STATISTIC: PushesOntoPoppedArrays >= 3
// A loop that pops an array and pushes what it reads out of other objects fetches the pushed cells ahead. What is pushed need be no cell.
const out = [];
const marker = {};
function traverse(root, enter, leave) {
  const work = [root];
  while (work.length > 0) {
    const node = work.pop();
    if (node === marker) { leave(work.pop()); continue; }
    if (leave) work.push(node, marker);
    if (node === null || typeof node !== "object") { enter(node); continue; }
    if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; --i) work.push(node[i]); continue; }
    if (enter(node) === false) continue;
    if (node.left !== undefined) work.push(node.right, node.left);
    else work.push(node.contents);
  }
}
const deep = (n, x) => n ? { left: deep(n - 1, x), right: [x, n, n + 0.5, null, undefined, true, "t" + n, Symbol.iterator, 10n, , -0, NaN] } : { contents: x };
const text = x => typeof x === "symbol" ? "symbol" : typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : typeof x === "object" && x ? Object.keys(x).join() : String(x);
for (const x of [1, "a", 0.25, {}, [], [[1], []], null, undefined, () => 1]) {
  const seen = []; let left = 0;
  traverse(deep(3, x), node => { seen.push(text(node)); return typeof node !== "function"; }, () => { left++; });
  traverse(deep(2, x), node => { seen.push(text(node)); });
  out.push(seen.join(" ") + " | " + left);
}
// The array that is popped is replaced, shortened, or of a subclass while the loop runs.
class Work extends Array {}
function run(work, list) { let n = 0; while (work.length && n < 40) { const x = work.pop(); n++; if (x && x.next) work.push(x.next); if (n === 7) work.length = 0; for (let i = 0; i < list.length; i++) if (n < 5) work.push(list[i]); } return n + ":" + work.length; }
const chain = { next: { next: { next: null } } };
out.push(run([chain], [1, chain, "x"]), run(new Work(chain, 2), [chain, undefined, , 4]), run([], []), run([chain, , 5], [0.5, -1]));
const accessor = { get next() { out.push("read"); return null; } };
out.push(run([accessor], [accessor]));
try { run(Object.freeze([chain]), []); } catch (e) { out.push(e.constructor.name); }
console.log(out.join("\n"));
