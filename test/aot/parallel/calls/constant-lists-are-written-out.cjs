// STATISTIC: ConstantListsWrittenOut >= 1
// f.apply(o, [1, 2]): the list's elements are the arguments, as long as nothing changes the list.
let count = 0, kept = null;
const o = { v: 1 };
function f(a, b) { return this.v + a + b; }
function each(...rest) { rest.push(count++); return rest.join(); }
function keep(list) { kept = list; return list; }
class Pair { constructor(a, b) { this.a = a; this.b = b; } }
function sum(turns) { let n = 0; for (let k = 0; k < turns; k++) n += f.call(o, k & 3, 2) + f.apply(o, [1, 2]); return n; }
console.log(sum(0), sum(1), sum(1000));
function tell(turns) {
  for (let k = 0; k < turns; k++) {
    console.log(f.apply(o, [k, "s"]), each(...[1, null, undefined, true, -0, 0.5, "text"]), each.apply(null, []), new Pair(...[3, 4]).b, Math.max(...[3, k, 2]), Math.max.apply(null, [3, 9, 2]));
    const list = [1, 2];
    if (k === 1) list[0] = "changed";
    if (k === 2) list.push(7);
    if (k === 3) list.length = 1;
    console.log(f.apply(o, list), each(...list), list.length);
    console.log(f.apply(o, keep([5, 6])), kept.join());
    kept[0]++;
    const [a, b, c = 8] = [k & 1 ? 1 : 2, 2];
    console.log(a, b, c, each.apply(null, [1, , 3]));
  }
}
tell(5);
o.v = { valueOf() { o.v = 4; return 100; } };
console.log(sum(3));
for (const target of [null, undefined, 3]) { try { console.log(f.apply(target, [1, 2])); } catch (error) { console.log(error.name); } }
