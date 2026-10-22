// A method called on the array literal that it was read off is resolved by the class of the literal, also where an argument is a call, so that the method is read first.
// IR= 0 collect TypeTest v[0-9]+ testedType=builtin\(
// IR= 0 collect PropGet v[0-9]+ name="push"(?!.* isFallback)
// IR= 1 collect CallBuiltin v[0-9]+ \(v[0-9]+\) overload=ArrayPrototypePush/
// IR= 0 collectSome TypeTest v[0-9]+ testedType=builtin\(
// IR= 1 collectSome CallBuiltin v[0-9]+ \(v[0-9]+\) overload=ArrayPrototypePush/
// IR= 0 prepend TypeTest v[0-9]+ testedType=builtin\(
// IR- TypeTest v[0-9]+ testedType=builtin\(ArrayPrototypePush\)
function collect<T, U>(items: readonly T[] | undefined, convert: (item: T, index: number) => U): U[] | undefined {
  let result: U[] | undefined;
  if (items !== undefined) {
    result = [];
    for (let i = 0; i < items.length; i++) {
      result.push(convert(items[i], i));
    }
  }
  return result;
}
function collectSome<T, U>(items: readonly T[], convert: (item: T) => U | undefined): U[] {
  const result: U[] = [];
  for (const item of items) {
    if (item !== undefined) result.push(orElse(convert(item), convert));
  }
  return result;
}
function orElse<T, U>(value: U | undefined, convert: (item: T) => U | undefined): U {
  if (value === undefined) throw new Error("nothing from " + convert.name);
  return value;
}
function prepend<T>(items: readonly T[], make: () => T): T[] {
  const result: T[] = [];
  result.unshift(make());
  for (const item of items) result.push(item);
  return result;
}
type Entry = { name: string; weight: number };
type Group = { entries: Entry[]; names: string[] | undefined; weights: number[] | undefined; readers: (() => number)[] | undefined };
function makeGroup(entries: Entry[]): Group {
  const group: Group = { entries, names: undefined, weights: undefined, readers: undefined };
  group.names = collect(group.entries, entry => entry.name);
  group.weights = collect(group.entries, (entry, i) => entry.weight * i);
  group.readers = collect(group.entries, (entry, i) => () => entry.weight + i);
  return group;
}
function lengths(texts: readonly string[]): number[] | undefined {
  return collect(texts, text => text.length);
}
function doubled(numbers: readonly number[]): number[] | undefined {
  return collect(numbers, double);
}
function double(n: number): number {
  return n * 2;
}
function applied(numbers: readonly number[], convert: (n: number, i: number) => number): number[] | undefined {
  return collect(numbers, convert);
}
const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const group = makeGroup([{ name: "a", weight: 3 }, { name: "b", weight: 5 }, { name: "c", weight: 7 }]);
console.log(group.names!.join(), group.weights!.join(), collect(group.readers, read => read())!.join());
console.log(lengths(["x", "yy", ""])!.join(), doubled(numbers)!.join(), collect(undefined, double));
console.log(applied(numbers, (n, i) => n - i)!.join(), applied(numbers, Math.max)!.join());
console.log(collectSome(numbers, n => n + 1).join(), collectSome(["x", "y"], s => s + s).join());
console.log(prepend(numbers, () => 0).join(), prepend(["b"], () => "a").join());
console.log(Array.prototype.slice.call(numbers, 7).join());
