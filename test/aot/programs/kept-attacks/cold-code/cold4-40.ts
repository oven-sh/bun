// Cold code, one probe of many. It prints what plain Bun prints.
function every<T>(array: readonly T[] | undefined, callback: (element: T, index: number) => boolean): boolean {
  if (array !== undefined) {
    for (let i = 0; i < array.length; i++) {
      if (!callback(array[i], i)) return false;
    }
  }
  return true;
}
interface Type { flags: number; types?: Type[] }
function everyType(type: Type, f: (t: Type) => boolean): boolean {
  return type.flags & 1 ? every(type.types, f) : f(type);
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
results.push(everyType(union, t => t.flags > 10), everyType(single, t => t.flags + 13 > 4));
results.push(everyType(union, t => t.flags > 11), everyType(single, t => t.flags + 14 > 4));
results.push(everyType(union, t => t.flags > 12), everyType(single, t => t.flags + 15 > 4));
results.push(everyType(union, t => t.flags > 13), everyType(single, t => t.flags + 16 > 4));
results.push(everyType(union, t => t.flags > 14), everyType(single, t => t.flags + 17 > 4));
results.push(everyType(union, t => t.flags > 15), everyType(single, t => t.flags + 18 > 4));
results.push(everyType(union, t => t.flags > 16), everyType(single, t => t.flags + 19 > 4));
results.push(everyType(union, t => t.flags > 17), everyType(single, t => t.flags + 20 > 4));
results.push(everyType(union, t => t.flags > 18), everyType(single, t => t.flags + 21 > 4));
results.push(everyType(union, t => t.flags > 19), everyType(single, t => t.flags + 22 > 4));
results.push(everyType(union, t => t.flags > 20), everyType(single, t => t.flags + 23 > 4));
results.push(everyType(union, t => t.flags > 21), everyType(single, t => t.flags + 24 > 4));
results.push(everyType(union, t => t.flags > 22), everyType(single, t => t.flags + 25 > 4));
results.push(everyType(union, t => t.flags > 23), everyType(single, t => t.flags + 26 > 4));
results.push(everyType(union, t => t.flags > 24), everyType(single, t => t.flags + 27 > 4));
results.push(everyType(union, t => t.flags > 25), everyType(single, t => t.flags + 28 > 4));
results.push(everyType(union, t => t.flags > 26), everyType(single, t => t.flags + 29 > 4));
results.push(everyType(union, t => t.flags > 27), everyType(single, t => t.flags + 30 > 4));
results.push(everyType(union, t => t.flags > 28), everyType(single, t => t.flags + 31 > 4));
results.push(everyType(union, t => t.flags > 29), everyType(single, t => t.flags + 32 > 4));
results.push(everyType(union, t => t.flags > 30), everyType(single, t => t.flags + 33 > 4));
results.push(everyType(union, t => t.flags > 31), everyType(single, t => t.flags + 34 > 4));
results.push(everyType(union, t => t.flags > 32), everyType(single, t => t.flags + 35 > 4));
results.push(everyType(union, t => t.flags > 33), everyType(single, t => t.flags + 36 > 4));
results.push(everyType(union, t => t.flags > 34), everyType(single, t => t.flags + 37 > 4));
results.push(everyType(union, t => t.flags > 35), everyType(single, t => t.flags + 38 > 4));
results.push(everyType(union, t => t.flags > 36), everyType(single, t => t.flags + 39 > 4));
results.push(everyType(union, t => t.flags > 37), everyType(single, t => t.flags + 40 > 4));
console.log(results.join(" "));
