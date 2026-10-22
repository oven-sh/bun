// Eight arrows reach one call, which is more than a call tests for one by one, so they form a group with an entry of its own. The callee may also be undefined, and a call by value is what is left
// of such a call where no test takes undefined away: in code that is not expected to run. It enters the arrows through the entries that every closure has.
type Test<T> = ((element: T, index: number) => boolean) | undefined;
function every<T>(array: readonly T[], callback: Test<T>): boolean {
  for (let i = 0; i < array.length; i++) {
    if (!callback!(array[i], i)) return false;
  }
  return true;
}
const numbers = [1, 2, 3];
const results: boolean[] = [every([], undefined)];
results.push(every(numbers, n => n > -3));
results.push(every(numbers, n => n > -2));
results.push(every(numbers, n => n > -1));
results.push(every(numbers, n => n > 0));
results.push(every(numbers, n => n > 1));
results.push(every(numbers, n => n > 2));
results.push(every(numbers, n => n > 3));
results.push(every(numbers, n => n > 4));
console.log(results.join(" "));
