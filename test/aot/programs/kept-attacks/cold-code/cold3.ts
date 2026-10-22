// Cold code, one probe of many. It prints what plain Bun prints.
function every<T>(array: readonly T[] | undefined, callback: (element: T, index: number) => boolean): boolean {
  if (array !== undefined) {
    for (let i = 0; i < array.length; i++) {
      if (!callback(array[i], i)) return false;
    }
  }
  return true;
}
const typed: number[] = [1, 2, 3];
// No array, whatever the annotation says: the tests at the head of `every` turn it away, and its untyped version runs.
const given = { length: 3, 0: 1, 1: 2, 2: 3 } as unknown as number[];
const results: boolean[] = [];
results.push(every(typed, n => n > -19), every(given, n => n + 1 > 0));
results.push(every(typed, n => n > -18), every(given, n => n + 2 > 0));
results.push(every(typed, n => n > -17), every(given, n => n + 3 > 0));
results.push(every(typed, n => n > -16), every(given, n => n + 4 > 0));
results.push(every(typed, n => n > -15), every(given, n => n + 5 > 0));
results.push(every(typed, n => n > -14), every(given, n => n + 6 > 0));
results.push(every(typed, n => n > -13), every(given, n => n + 7 > 0));
results.push(every(typed, n => n > -12), every(given, n => n + 8 > 0));
results.push(every(typed, n => n > -11), every(given, n => n + 9 > 0));
results.push(every(typed, n => n > -10), every(given, n => n + 10 > 0));
results.push(every(typed, n => n > -9), every(given, n => n + 11 > 0));
results.push(every(typed, n => n > -8), every(given, n => n + 12 > 0));
results.push(every(typed, n => n > -7), every(given, n => n + 13 > 0));
results.push(every(typed, n => n > -6), every(given, n => n + 14 > 0));
results.push(every(typed, n => n > -5), every(given, n => n + 15 > 0));
results.push(every(typed, n => n > -4), every(given, n => n + 16 > 0));
results.push(every(typed, n => n > -3), every(given, n => n + 17 > 0));
results.push(every(typed, n => n > -2), every(given, n => n + 18 > 0));
results.push(every(typed, n => n > -1), every(given, n => n + 19 > 0));
results.push(every(typed, n => n > 0), every(given, n => n + 20 > 0));
results.push(every(typed, n => n > 1), every(given, n => n + 21 > 0));
results.push(every(typed, n => n > 2), every(given, n => n + 22 > 0));
results.push(every(typed, n => n > 3), every(given, n => n + 23 > 0));
results.push(every(typed, n => n > 4), every(given, n => n + 24 > 0));
console.log(results.join(" "));
