// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the text of filter and the arrow's body are copied into a body that calls itself: the checks read the copy
function spread(values: number[], sign: number): number[] {
  if (values.length <= 1) return values.slice();
  const even = spread(values.filter((_, at) => (at & 1) === 0), sign);
  const odd = spread(values.filter((_, at) => (at & 1) === 1), sign);
  const out: number[] = new Array(values.length).fill(0);
  for (let at = 0; at < even.length; at++) { const turned = (odd[at] ?? 0) * sign; out[at] = even[at]! + turned; out[at + even.length] = even[at]! - turned; }
  return out.slice(0, values.length);
}
class Sorter {
  passes = 0;
  sort(list: number[]): number[] {
    this.passes++;
    if (list.length < 2) return list;
    const pivot = list[0]!;
    return [...this.sort(list.filter((x, at) => at > 0 && x < pivot)), pivot, ...this.sort(list.filter((x, at) => at > 0 && x >= pivot))];
  }
}
const holes = [1, , 3, , 5] as number[];
const count = function walk(list: number[], depth: number): number { return depth ? walk(list.filter(x => x !== undefined), depth - 1) + list.length : list.length; };
const thrower = (list: number[], depth: number): number => { if (!depth) return list.filter(x => { if (x > 2) throw new RangeError("over " + x); return true; }).length; return thrower(list, depth - 1); };
const sorter = new Sorter();
const said: unknown[] = [spread([1, 2, 3, 4, 5, 6, 7, 8], 1).join(), spread([5, 3, 1], -1).join(), spread([], 1).length, sorter.sort([5, 3, 8, 1, 9, 2, 7, 3]).join(), sorter.passes, count(holes, 2)];
try { said.push(thrower([1, 2, 3], 3)); } catch (error) { said.push((error as Error).message); }
console.log(said.map(String).join(" | "));
