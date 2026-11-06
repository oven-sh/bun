class List extends Array<number> {
  sum(): number { let total = 0; for (const value of this) total += value; return total; }
  static made = 0;
  constructor(...items: number[]) { super(...items); List.made++; }
}
class Plain extends Array<number> { static get [Symbol.species](): any { return Array; } sum(): number { return -1; } }
class Odd extends Array<number> { static get [Symbol.species](): any { return List; } sum(): number { return -2; } }
class Returned extends Array<number> { constructor() { super(); return [7, 8] as any; } sum(): number { return -3; } }
class ReturnedList extends Array<number> { constructor() { super(); return new List(5, 6) as any; } sum(): number { return -4; } }
function sumOf(list: List): unknown { return list.sum(); }
function sumOfAny(list: List | Plain | Odd | Returned | ReturnedList): unknown { return (list as any).sum?.(); }
function show(label: string, value: any) {
  let a: unknown, b: unknown;
  try { a = sumOf(value); } catch (e) { a = (e as Error).constructor.name; }
  try { b = sumOfAny(value); } catch (e) { b = (e as Error).constructor.name; }
  console.log(label, a, b, value.constructor.name, value.length, Array.isArray(value), value instanceof List, JSON.stringify(value));
}
for (let round = 0; round < 3; round++) {
  const list = new List(1, 2, 3);
  show("new", list); show("map", list.map(x => x * 2)); show("filter", list.filter(x => x > 1)); show("slice", list.slice(1)); show("concat", list.concat([4])); show("splice", list.splice(0, 1));
  show("flat", list.flat()); show("flatMap", list.flatMap(x => [x, x])); show("from", List.from([4, 5])); show("of", List.of(6, 7)); show("toSorted", (list as any).toSorted()); show("with", (list as any).with(0, 9));
  show("one number", new List(3)); show("empty", new List());
  const plain = new Plain(); plain.push(1, 2); show("plain", plain); show("plain map", plain.map(x => x));
  const odd = new Odd(); odd.push(1, 2); show("odd", odd); show("odd map", odd.map(x => x)); show("odd filter", odd.filter(() => true));
  show("returned", new Returned()); show("returned list", new ReturnedList());
  show("from for a call", (Array.from as any).call(List, [1, 2])); show("of for a call", (Array.of as any).call(List, 1, 2));
  list.length = 0; show("emptied", list); list[5] = 1; show("holes", list); list.push(1.5); show("fractions", list); (list as any).push("text"); show("texts", list);
}
console.log(List.made);
