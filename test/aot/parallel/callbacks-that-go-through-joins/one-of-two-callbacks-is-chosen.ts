function visitAll(list: number[], one: (x: number) => number, many?: (l: number[]) => number): number {
  const chosen = many || one;
  if (chosen === many) return many!(list);
  let t = 0; for (const x of list) t += one(x); return t;
}
function visitEither(list: number[], one: (x: number) => number, other: (x: number) => number, first: boolean): number {
  const chosen = first ? one : other;
  let t = 0; for (const x of list) t += chosen(x); return t;
}
function work(k: number): string { return visitAll([1, 2], x => x + k) + ":" + visitAll([1, 2], x => x, l => l.length * k) + ":" + visitEither([1, 2], x => x * k, x => x - k, k > 2) ; }
console.log(work(1), work(5));
