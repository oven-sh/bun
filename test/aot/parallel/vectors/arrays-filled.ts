// New arrays that are filled: every length around the width of vectors, every kind of storage.
function filled<T>(n: number, value: T) { return new Array<T>(n).fill(value); }
function numbers(n: number, value: number) { return new Array(n).fill(value); }
const object = { name: "object" };
for (const n of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 24, 31, 33, 100, 1000, 70001]) {
  for (const value of [true, 0, 7, -0, 0.5, NaN, "text", undefined, null, object, 2 ** 32, -2147483648] as unknown[]) {
    const list = filled(n, value);
    let same = 0;
    for (let i = 0; i < list.length; i++) same += Object.is(list[i], value) ? 1 : 0;
    list.push(value);
    console.log(n, String((value as { name?: string })?.name ?? value), list.length, same, n in list, n + 1 in list, list.lastIndexOf(value));
  }
  for (const value of [0, 3, 0.25, NaN, -0]) {
    const list = numbers(n, value);
    list.length = n + 2;
    let sum = 0;
    for (const x of list) sum += x ?? 1;
    console.log(n, value, sum, n in list, list.length);
  }
}
