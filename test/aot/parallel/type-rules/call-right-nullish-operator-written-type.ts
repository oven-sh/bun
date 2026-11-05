// Where nothing outside gives `??` or `||` a type, the right side is written for the type of the left side. A type parameter that stands only in the result of a call there, like the second one of `then`, is inferred from it, here `number | undefined`, so these sums may add `undefined`.
const holder: { missing?: { deep: { read(value: number): number } } } = {};
const counter = { total: 0 };
function pick<T, U = never>(value: T, other?: U): T | U {
  return value;
}
function maybe(): number | undefined {
  return undefined;
}
counter.total += holder.missing?.deep.read(1) ?? (await Promise.resolve(2).then((value: number) => 3));
counter.total += maybe() || pick(3);
console.log(counter.total);
export {};
/* Build errors:
error: TS2532: Object is possibly 'undefined'.
*/
