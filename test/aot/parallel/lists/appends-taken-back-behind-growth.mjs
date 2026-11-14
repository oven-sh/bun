// A list grows between an append and a value that leaves the loop's version: the append is taken back.
// STATISTIC: StoresGrowingArrays >= 4
// Under: --aot-testing=CheckEffectsAtRunTime: an iteration that runs again has done nothing that is seen
const held = { list: [] };
function two(xs) { const b = [1], a = []; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a[a.length] = x; b[b.length] = held.list[i]; } return [a, b]; }
function three(xs) { const c = [0.5], b = [1], a = []; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a[a.length] = x; c[c.length] = x * 2; b[b.length] = held.list[i]; } return [a, b, c]; }
function same(xs) { const b = ["b"], a = [0.5]; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a[a.length] = x; a[a.length] = -x; b[b.length] = held.list[i]; } return [a, b]; }
function nested(xs) { const all = []; for (let k = 0; k < 2; k++) { const b = [1], a = []; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a[a.length] = x; b[b.length] = held.list[i]; } all.push(a, b); } return all; }
function condition(xs) { const b = [1], a = []; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a[a.length] = x; if (x > 1) b[b.length] = held.list[i]; } return [a, b]; }
const bodies = { two, three, same, nested, condition };
const many = Array.from({ length: 40 }, (_, i) => i + 0.5);
for (const list of [[], [1], ["a"], [1, 2.5], [1, 2, "c"], [1, , 3], [1, 2, 3, undefined]]) {
  for (const name in bodies) {
    for (const xs of [[1, 2, 3, 0.5], [1, 2, 3, 4], ["t", 1], many]) {
      held.list = list.slice();
      console.log(name, JSON.stringify(bodies[name](xs)).slice(0, 180));
    }
  }
}
