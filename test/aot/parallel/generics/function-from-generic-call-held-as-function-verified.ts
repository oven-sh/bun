// What a generic call hands back is a function expression by its type argument, and a variable of the type Function holds it. A member under a computed key is then updated on it.
// Flags: --aot-check=verify-each-pass
const handBack = <V>(value: V): V => value;
const key: any = { toString: () => "count" };
const held: Function = handBack(function (a: number, b: number) {});
const target: any = held;
target.count = 1;
target[key] += 1;
console.log(target[key], target.count, held.length, typeof held);
try {
  const nothing: Function = handBack(null as any);
  const other: any = nothing;
  other[key] += 1;
} catch (error) {
  console.log((error as Error).name);
}
