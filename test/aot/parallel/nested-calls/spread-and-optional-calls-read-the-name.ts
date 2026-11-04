function outer(list: number[]) {
  const a = sum(...list);
  const b = sum(1, ...list, 2);
  const c = sum?.(3, 4);
  return [a, b, c].join(",");
  function sum(...xs: number[]): number { let t = 0; for (const x of xs) t += x; return t; }
}
console.log(outer([5, 6, 7]));
