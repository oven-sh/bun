class Rows<T> extends Array<T> {
  first(): T | undefined { return this[0]; }
  total(): number { let n = 0; for (let i = 0; i < this.length; i++) n += Number(this[i] ?? 100); return n; }
}
class Loud extends Rows<number> {
  push(...items: number[]): number { console.log("push", items.length); return super.push(...items); }
  *[Symbol.iterator](): ArrayIterator<number> { for (let i = this.length - 1; i >= 0; i--) yield this[i]!; }
}
function every(list: any, tag: string): void {
  const out: unknown[] = [];
  out.push(list.length, list.slice().length, list.slice(1).constructor.name, list.indexOf(2), list.includes(3), list.at(-1), list.join("+"));
  out.push(list.concat([9]).length, list.concat([9]).constructor.name, list.map((x: number) => x * 2).constructor.name, list.filter((x: number) => x > 1).length);
  out.push(list.reduce((a: number, b: number) => a + b, 0), list.some((x: number) => x === 2), list.every((x: number) => x > 0), list.find((x: number) => x > 1), list.findLast((x: number) => x > 1));
  out.push([...list].join(), Array.from(list).join(), Array.isArray(list), JSON.stringify(list), Object.keys(list).join(), String(list), list.lastIndexOf(1));
  const [a, b, ...rest] = list;
  out.push(a, b, rest.length, rest.constructor.name);
  let sum = 0;
  for (const value of list) sum += value;
  out.push(sum);
  for (const [index, value] of list.entries()) sum += index * value;
  out.push(sum, list.flat().constructor.name, list.toSorted().constructor.name, list.toReversed().join(), list.with(0, 7).join());
  console.log(tag, ...out);
}
function changes(list: any, tag: string): void {
  const out: unknown[] = [];
  out.push(list.push(4), list.pop(), list.shift(), list.unshift(1), list.reverse().join(), list.sort().join(), list.splice(1, 1).constructor.name, list.fill(5, 1).join(), list.copyWithin(0, 1).join());
  list.length = 1; out.push(list.join(), list.length);
  list[3] = 8; out.push(list.length, 2 in list, list[2], list.indexOf(undefined), list.includes(undefined), list.join());
  console.log(tag, ...out);
}
function typedList(list: number[]): number { let n = list.length; for (const v of list) n += v; n += list[0]! + (list.at(1) ?? 0) + list.indexOf(3); list.push(1); n += list.pop()!; return n; }
function typedRows(list: Rows<number>): number { let n = list.length + list.total(); for (const v of list) n += v; n += list[0]! + (list.at(1) ?? 0) + list.indexOf(3); list.push(1); n += list.pop()!; return n + (list.first() ?? 0); }
for (let turn = 0; turn < 3; turn++) {
  const plain = [1, 2, 3];
  const rows = new Rows<number>(); rows.push(1, 2, 3);
  const from = Rows.from([1, 2, 3]) as Rows<number>;
  const of = Rows.of(1, 2, 3) as Rows<number>;
  const loud = new Loud(); loud.push(1, 2, 3);
  const sized = new Rows<number>(3); sized[0] = 1; sized[2] = 3;
  for (const [tag, list] of [["plain", plain], ["rows", rows], ["from", from], ["of", of], ["loud", loud]] as [string, number[]][]) {
    every(list, tag);
    console.log(tag, typedList(list), list instanceof Rows ? typedRows(list as Rows<number>) : -1);
    changes(list, tag);
  }
  console.log(sized.length, sized.total(), sized.first(), 1 in sized, sized.indexOf(undefined as any), sized.includes(undefined as any), typedRows(sized), JSON.stringify(sized));
}
