// An array literal of constants can lie in read-only data as long as nobody writes it, asks who it is, or keeps it where a write may follow. Each evaluation of the literal is a new array: a change to one is not seen in the next, two are never the same, and a helper that "only reads" may hand it to one that sorts.
function primes(): number[] {
  return [2, 3, 5, 7, 11];
}
function names(): string[] {
  return ["ada", "grace", "edsger"];
}
function grid(): number[][] {
  return [
    [1, 2],
    [3, 4],
  ];
}
function mixed(): (number | string | null | boolean)[] {
  return [1, "two", null, true, 2.5, -0];
}
function holes(): (number | undefined)[] {
  return [1, , 3];
}
function empty(): number[] {
  return [];
}
function records(): { id: number; tags: string[] }[] {
  return [
    { id: 1, tags: ["a"] },
    { id: 2, tags: [] },
  ];
}
function sumOf(list: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
function largest(list: number[]): number {
  return list.sort((a, b) => b - a)[0];
}
function readsOrSorts(list: number[], sorts: boolean): number {
  return sorts ? largest(list) : list[0];
}
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sumOf(primes()) + sumOf([1, 2, 3]) + names().length + grid()[1][0] + readsOrSorts([4, 9, 6], false) + mixed().length + empty().length + records()[1].id;
console.log(warm);

// Two evaluations are two arrays.
console.log(primes() === primes(), grid()[0] === grid()[0], records()[0] === records()[0], records()[0].tags === records()[0].tags, empty() === empty(), new Set([primes(), primes()]).size, Object.is(mixed()[5], -0));
function twice(): boolean {
  const lists: number[][] = [];
  for (let i = 0; i < 2; i++) lists.push([1, 2, 3]);
  return lists[0] === lists[1];
}
console.log(twice());

// Every way to change one, and then a new one is looked at.
const changes: [string, (list: number[]) => unknown][] = [
  ["store", l => (l[0] = 99)],
  ["push", l => l.push(99)],
  ["pop", l => l.pop()],
  ["shift", l => l.shift()],
  ["unshift", l => l.unshift(99)],
  ["sort", l => l.sort((a, b) => b - a)],
  ["reverse", l => l.reverse()],
  ["splice", l => l.splice(1, 2)],
  ["fill", l => l.fill(0)],
  ["copyWithin", l => l.copyWithin(0, 3)],
  ["length", l => (l.length = 1)],
  ["grow", l => (l[10] = 1)],
  ["delete", l => delete l[0]],
  ["a double", l => (l[0] = 0.5)],
  ["a string", l => ((l as unknown[])[0] = "s")],
  ["a property", l => ((l as unknown as { extra: number }).extra = 1)],
  ["defineProperty", l => Object.defineProperty(l, 0, { value: 99 })],
  ["an accessor", l => Object.defineProperty(l, 0, { get: () => 99 })],
  ["assign", l => Object.assign(l, [99, 98])],
  ["Reflect.set", l => Reflect.set(l, 0, 99)],
  ["swap", l => ([l[0], l[1]] = [l[1], l[0]])],
  ["increment", l => l[0]++],
  ["compound", l => (l[0] += 5)],
  ["destructuring", l => ([l[0]] = [99])],
  ["for-of target", l => {
    for (l[0] of [99]);
  }],
  ["borrowed push", l => Array.prototype.push.call(l, 99)],
  ["freeze", l => Object.freeze(l)],
  ["seal", l => Object.seal(l)],
  ["setPrototypeOf", l => Object.setPrototypeOf(l, null)],
];
for (const [name, change] of changes) {
  const mine = primes();
  change(mine);
  const next = primes();
  console.log(name + ":", Array.prototype.join.call(mine, "/"), "|", next.join("/"), Object.isFrozen(next), Object.isSealed(next), Object.getPrototypeOf(next) === Array.prototype, Object.keys(next).length);
}

// The literal goes to a helper that sorts on a rare path; the caller reads it afterwards, and the next round gets a new one.
let trace = "";
for (let i = 0; i < 300; i++) {
  const list = [4, 9, 6];
  const answer = readsOrSorts(list, i % 100 === 99);
  if (i % 100 >= 98) trace += answer + ":" + list.join("") + " ";
}
console.log(trace);

// Kept, and written much later.
const keptLists: number[][] = [];
function keepSome(list: number[], i: number): number {
  if (i % 100 === 50) keptLists.push(list);
  return list[1];
}
for (let i = 0; i < 300; i++) warm += keepSome([10, 20, 30], i);
keptLists[0][1] = -1;
keptLists[1].push(40);
console.log(keptLists.map(l => l.join("/")).join(" "), keepSome([10, 20, 30], 1), keptLists[0] === keptLists[1]);

// Inner arrays and objects of a constant literal.
const g1 = grid();
g1[0][0] = 100;
g1[1] = [0];
const r1 = records();
r1[0].tags.push("b");
r1[1].id = 20;
console.log(JSON.stringify(g1), JSON.stringify(grid()), JSON.stringify(r1), JSON.stringify(records()));

// Holes stay holes; strings stay what they were.
const h = holes();
console.log(1 in h, h.length, Object.keys(h).join(), (h[1] = 2), 1 in holes(), names().map(n => n.toUpperCase()).join(), names().join());

// A default parameter, a class field, a spread, a template's strings.
function withDefault(list: number[] = [1, 2]): number[] {
  list.push(3);
  return list;
}
class WithField {
  list = [1, 2];
}
function tag(strings: TemplateStringsArray, ...values: number[]): TemplateStringsArray {
  return strings;
}
function tagged(): TemplateStringsArray {
  return tag`a${1}b`;
}
console.log(withDefault().join(), withDefault().join(), new WithField().list === new WithField().list, (new WithField().list.push(3), new WithField().list.join()), [...[1, 2]].concat([3]).join());
console.log(tagged() === tagged(), Object.isFrozen(tagged()), tagged().raw === tagged().raw, tag`a${1}b` === tag`a${1}b`);

// Typed arrays and constant arguments of built-ins.
function bytes(): Uint8Array {
  return new Uint8Array([1, 2, 3]);
}
const b1 = bytes();
b1[0] = 9;
console.log(b1.join(), bytes().join(), Math.max(...[1, 5, 3]), [3, 1, 2].sort().join(), [3, 1, 2].toSorted().join(), [1, 2, 3].includes(2), [1, 2, 3].indexOf(4), ["a", "b"].join("-"), [[1, 2], [3]].flat().join(), new Map([[1, "x"]]).get(1), new Set([1, 1, 2]).size);
