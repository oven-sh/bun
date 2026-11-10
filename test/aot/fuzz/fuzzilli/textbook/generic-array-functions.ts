function last<T>(list: T[]): T | undefined {
  return list.length ? list[list.length - 1] : undefined;
}
function mapped<T, U>(list: T[], change: (one: T, at: number) => U): U[] {
  const out: U[] = [];
  for (let i = 0; i < list.length; i++) out.push(change(list[i], i));
  return out;
}
console.log(last([1, 2, 3]), last(["a"]), last([]), mapped([1, 2, 3], (one, at) => one * at).join());
