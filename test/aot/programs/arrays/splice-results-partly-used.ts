// splice whose result is not used, or of which only the length or the first elements are read: the array changes as it always does, and what is read of the removed elements is what
// the array of removed elements would have answered. Every way an array keeps its elements, holes, ranges off both ends, inserted items that do not fit, and arrays that refuse the change.
const lines: string[] = [];
const show = (label: string, ...values: unknown[]) => lines.push(label + ": " + values.map(value => JSON.stringify(value) ?? String(value)).join(" "));

function removeOne<T>(list: T[], at: number): void {
  list.splice(at, 1);
}
function takeOne<T>(list: T[], at: number): T | undefined {
  return list.splice(at, 1)[0];
}
function takeTwo<T>(list: T[], at: number): [T | undefined, T | undefined, T | undefined] {
  const [first, second, third] = list.splice(at, 2);
  return [first, second, third];
}
function countRemoved<T>(list: T[], at: number, count: number): number {
  return list.splice(at, count).length;
}
function replaceOne<T>(list: T[], at: number, item: T): T | undefined {
  return list.splice(at, 1, item)[0];
}
function insertTwo<T>(list: T[], at: number, a: T, b: T): void {
  list.splice(at, 0, a, b);
}
function removedIsThere<T>(list: T[], at: number): boolean {
  return 0 in list.splice(at, 1);
}
function wholeResult<T>(list: T[], at: number): T[] {
  return list.splice(at, 1);
}

const makers: [string, () => unknown[]][] = [
  ["integers", () => [1, 2, 3, 4, 5]],
  ["doubles", () => [1.5, 2.5, 3.5, 4.5, 5.5]],
  ["strings", () => ["a", "b", "c", "d", "e"]],
  ["mixed", () => [1, "b", 3.5, null, { e: 5 }]],
  ["holes", () => [1, , 3, , 5]],
  ["holes among doubles", () => [1.5, , 3.5, , 5.5]],
  ["holes among strings", () => ["a", , "c", , "e"]],
  ["one", () => [7]],
  ["none", () => []],
  ["long", () => Array.from({ length: 200 }, (_, i) => i)],
  ["pushed", () => { const list: unknown[] = []; for (let i = 0; i < 9; i++) list.push(i * 2); return list; }],
];
const short = (list: unknown[]) => (list.length > 12 ? [list.length, ...list.slice(0, 4), ...list.slice(-2)] : list);
for (let round = 0; round < 40; round++) {
  const print = round === 0 || round === 39;
  for (const [name, make] of makers) {
    for (const at of [0, 1, 3, 4, 5, 9, -1, -2, -9]) {
      let list = make();
      removeOne(list, at);
      if (print) show(name + " removeOne " + at, short(list), list.length);
      list = make();
      const one = takeOne(list, at);
      if (print) show(name + " takeOne " + at, one, short(list));
      list = make();
      const two = takeTwo(list, at);
      if (print) show(name + " takeTwo " + at, two.map(String), short(list));
      list = make();
      const count = countRemoved(list, at, round % 4);
      if (print) show(name + " countRemoved " + at, count, short(list));
      list = make();
      const replaced = replaceOne(list, at, round % 2 ? "item" : 0.5);
      if (print) show(name + " replaceOne " + at, replaced, short(list));
      list = make();
      insertTwo(list, at, 10, round % 3 ? 11 : "eleven");
      if (print) show(name + " insertTwo " + at, short(list));
      list = make();
      const there = removedIsThere(list, at);
      if (print) show(name + " removedIsThere " + at, there);
      list = make();
      const whole = wholeResult(list, at);
      if (print) show(name + " wholeResult " + at, whole, Object.keys(whole).join());
    }
  }
}

// Arrays that are not what the inline code moves by itself.
class Stack<T> extends Array<T> {}
const stack = Stack.from([1, 2, 3]);
show("subclass", takeOne(stack, 1), [...stack], stack.splice(0, 1) instanceof Stack);
const frozen = Object.freeze([1, 2, 3]) as number[];
try {
  removeOne(frozen, 0);
  show("frozen", "no error");
} catch (error) {
  show("frozen", (error as Error).constructor.name, frozen);
}
const named = Object.assign([1, 2, 3], { extra: "kept" });
removeOne(named, 1);
show("named property", named, named.extra);
const sparse: number[] = [];
sparse[5000] = 1;
show("sparse", takeOne(sparse, 5000), sparse.length, countRemoved(sparse, 10, 20), sparse.length);
const shared = () => [1, 2, 3];
const firstCopy = shared();
removeOne(firstCopy, 0);
show("literal made twice", firstCopy, shared());

console.log(lines.length);
console.log(lines.join("\n"));
