class A {
  constructor(public n: number) {}
  f() {
    return "A" + this.n;
  }
}
const list = [new A(2), new A(1)];
function first(xs: A[], depth: number): string {
  if (depth > 0) return first(xs, depth - 1);
  if (xs.length < 2) return "short";
  let text = "";
  for (let i = 0; i < xs.length; i++) text += xs[i].f();
  return text;
}
const byN = (a: A, b: A) => a.n - b.n;
console.log(
  first(list.map(x => x), 1),
  first(list.filter(x => x.n), 1),
  first(list.slice(), 1),
  first(list.concat(list), 1),
  first(list.toSorted(byN), 1),
  first(list.flat(), 1),
  first(list.flatMap(x => [x]), 1),
  first(Array.from(list), 1),
  first(Array.from(list, x => x), 1),
  first(list.toReversed(), 1),
  first(list.toSpliced(0, 0), 1),
  first(list.with(0, list[1]), 1),
  first([...list].reverse(), 1),
  first([...list].sort(byN), 1),
  first(Object.values({ a: list[0], b: list[1] }), 1),
  first(list.map(x => x).sort(byN), 1),
  first(list.filter(x => x.n).reverse(), 1),
  first(list.slice().sort(byN).map(x => x), 1),
  first(Array.of(list[0], list[1]), 1),
  first(list.splice(0, 2), 1),
);
