// Cold code, one probe of many. It prints what plain Bun prints.
type Test<T> = ((element: T, index: number) => boolean) | undefined;
function every<T>(array: readonly T[] | undefined, callback: Test<T>): boolean {
  if (array !== undefined) {
    for (let i = 0; i < array.length; i++) {
      if (!callback!(array[i], i)) return false;
    }
  }
  return true;
}
interface Type { flags: number; types?: Type[] }
function everyType(type: Type, f: Test<Type>): boolean {
  return type.flags & 1 ? every(type.types, f) : f!(type, 0);
}
const union: Type = { flags: 1, types: [{ flags: 2 }, { flags: 4 }] };
const single: Type = { flags: 2 };
const results: boolean[] = [];
results.push(everyType(union, t => t.flags > -2), everyType(single, t => t.flags + 1 > 4));
results.push(everyType(union, t => t.flags > -1), everyType(single, t => t.flags + 2 > 4));
results.push(everyType(union, t => t.flags > 0), everyType(single, t => t.flags + 3 > 4));
results.push(everyType(union, t => t.flags > 1), everyType(single, t => t.flags + 4 > 4));
results.push(everyType(union, t => t.flags > 2), everyType(single, t => t.flags + 5 > 4));
results.push(everyType(union, t => t.flags > 3), everyType(single, t => t.flags + 6 > 4));
results.push(everyType(union, t => t.flags > 4), everyType(single, t => t.flags + 7 > 4));
results.push(everyType(union, t => t.flags > 5), everyType(single, t => t.flags + 8 > 4));
results.push(everyType(union, t => t.flags > 6), everyType(single, t => t.flags + 9 > 4));
results.push(everyType(union, t => t.flags > 7), everyType(single, t => t.flags + 10 > 4));
results.push(everyType(union, t => t.flags > 8), everyType(single, t => t.flags + 11 > 4));
results.push(everyType(union, t => t.flags > 9), everyType(single, t => t.flags + 12 > 4));
console.log(results.join(" "));
