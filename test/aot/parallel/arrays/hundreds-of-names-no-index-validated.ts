// Negative numbers name properties of an array, no elements, and some hundreds of them make a dictionary of its structure. None of them shadows a member of Array.prototype, so what is proven of the array's names stays true, and a validating build has nothing to find.
// Flags: --aot-validate
type Path = { oldPos: number; steps: number };
// The shortest edit between two lists: the best path of each diagonal is kept in one array, and the diagonals left of the middle have negative numbers.
function edits(a: string[], b: string[]): number {
  const bestPath: (Path | undefined)[] = [{ oldPos: -1, steps: 0 }];
  const follow = (path: Path, diagonal: number): number => {
    let oldPos = path.oldPos, newPos = oldPos - diagonal;
    while (newPos + 1 < b.length && oldPos + 1 < a.length && a[oldPos + 1] === b[newPos + 1]) { newPos++; oldPos++; }
    path.oldPos = oldPos;
    return newPos;
  };
  if (follow(bestPath[0]!, 0) + 1 >= b.length && bestPath[0]!.oldPos + 1 >= a.length) return 0;
  for (let length = 1; length <= a.length + b.length; length++) {
    for (let diagonal = -length; diagonal <= length; diagonal += 2) {
      const remove = bestPath[diagonal - 1], add = bestPath[diagonal + 1];
      if (remove) bestPath[diagonal - 1] = undefined;
      const canAdd = add !== undefined && add.oldPos - diagonal >= 0 && add.oldPos - diagonal < b.length;
      const canRemove = remove !== undefined && remove.oldPos + 1 < a.length;
      if (!canAdd && !canRemove) { bestPath[diagonal] = undefined; continue; }
      const path: Path = !canRemove || (canAdd && remove!.oldPos < add!.oldPos) ? { oldPos: add!.oldPos, steps: add!.steps + 1 } : { oldPos: remove!.oldPos + 1, steps: remove!.steps + 1 };
      const newPos = follow(path, diagonal);
      if (path.oldPos + 1 >= a.length && newPos + 1 >= b.length) return path.steps;
      bestPath[diagonal] = path;
    }
  }
  return -1;
}
for (const count of [1, 64, 65, 150]) {
  const a = Array.from({ length: count }, (_, i) => "a" + i), b = Array.from({ length: count }, (_, i) => "b" + i);
  console.log(count, edits(a, b));
}

function lengths(a: number[], n: number): number {
  let sum = 0;
  for (let i = -n; i < 0; i++) { a[i] = 1; if (sum === -1) a.pop(); sum += a.length; }
  return sum;
}
for (const count of [128, 129, 300]) console.log(count, lengths([1, 2, 3], count));

function named(count: number): string {
  const a: number[] = [1, 2, 3];
  for (let i = 0; i < count; i++) (a as any)["name" + i] = i;
  a.push(4);
  return a.map(value => value * 2).join() + " " + a.pop() + " " + Object.keys(a).length + " " + (a as any)["name" + (count - 1)];
}
for (const count of [10, 300]) console.log(count, named(count));
