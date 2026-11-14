// Behind a push, a value leaves the loop's version: the push is taken back.
// STATISTIC: StoresGrowingArrays >= 8
// Under: --aot-testing=CheckEffectsAtRunTime: an iteration that runs again has done nothing that is seen
const held = { list: [], value: 1 };
function two(xs) { const b = [1], a = []; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a.push(x); b.push(held.list[i]); } return [a, b]; }
function counter(xs, ys) { const b = [0.5], a = []; let i = 0; for (const x of xs) { b.push(i); a.push(ys[i]); i++; } return [a, b]; }
function inner(xs, ys) { const all = []; for (let k = 0; k < 2; k++) { const a = [0, 0, 0, 0], b = [0.5]; for (let i = 0; i < xs.length; i++) { b.push(ys[i]); a.push(xs[i]); } all.push(a, b); } return all; }
function three(xs, ys) { const a = [], b = [0.5], c = [1]; for (let i = 0; i < xs.length; i++) { a.push(xs[i]); b.push(xs[i] * 2); c.push(ys[i]); } return [a, b, c]; }
function stores(xs, ys) { const a = [], b = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < xs.length; i++) { a.push(xs[i]); b[i] = ys[i]; } return [a, b]; }
function condition(xs, ys) { const a = [], b = [1]; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a.push(x); if (x > 1) b.push(ys[i]); } return [a, b]; }
function handled(xs, ys) { const a = [], b = [1]; let caught = 0; try { for (let i = 0; i < xs.length; i++) { a.push(xs[i]); b.push(ys[i] + held.value); } } catch { caught = 1; } return [a, b, caught]; }
function sum(xs, ys) { const a = []; let s = 0; for (let i = 0; i < xs.length; i++) { a.push(xs[i]); s += ys[i]; } return [a, s]; }
function early(xs, ys) { const a = []; for (let i = 0; i < xs.length; i++) { a.push(xs[i]); if (ys[i] === undefined) return a; a.push(ys[i]); } return a; }
function frozen(xs, ys) { const a = [], b = [0.5]; if (ys.length === 1) Object.freeze(b); if (ys.length === 2) Object.defineProperty(b, "length", { writable: false }); try { for (let i = 0; i < xs.length; i++) { a.push(xs[i]); b.push(xs[i]); } } catch (e) { return [a, b, e.constructor.name]; } return [a, b]; }
function outer(xs, ys) { const all = []; for (let t = 0; t < xs.length; t++) { const a = []; for (let i = 0; i < 4; i++) { const x = xs[i]; a.push(ys[i]); } all.push(a); } return all; }
function skipped(xs, ys) { const all = []; for (let t = 0; t < 2; t++) { const a = [0], b = [0.5]; for (const x of xs) { if (x === 3) continue; b.push(x); a.push(ys[t]); } all.push([a, b]); } return all; }
const bodies = { two, counter, inner, three, stores, condition, handled, sum, early, frozen, outer, skipped };
const many = Array.from({ length: 40 }, (_, i) => i + 0.5);
for (const list of [[], [1], ["a"], [1, 2.5], [1, 2, "c"], [1, , 3], [1, 2, 3, undefined], [{ valueOf() { throw new Error(); } }, 1]]) {
  for (const name in bodies) {
    for (const xs of [[1, 2, 3, 0.5], [1, 2, 3, 4], ["t", 1], many]) {
      held.list = list.slice();
      let answer;
      try { answer = JSON.stringify(bodies[name](xs, list.slice())); } catch (e) { answer = e.constructor.name; }
      console.log(name, answer.slice(0, 180));
    }
  }
}
