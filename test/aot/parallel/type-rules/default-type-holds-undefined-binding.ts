// A type parameter that stands only in the result of a call is inferred from the type the call is written for, here `number | undefined`, so these defaults may be `undefined` and so may the bindings.
function pick<T, U = never>(value: T, other?: U): T | U {
  return value;
}
let { a = pick(1) }: { a?: number } = {};
const fromCall: number = a;

async function awaits() {
  let { b = await Promise.resolve(1).then((value: number) => value) }: { b?: number } = {};
  const fromThen: number = b;
  console.log(fromThen);
}
await awaits();
console.log(fromCall);
export {};
/* Build errors:
error: TS2322: Type 'number | undefined' is not assignable to type 'number'.
*/
