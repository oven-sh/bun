// The same field without the `!`: declared as the function or undefined, and undefined until the executor runs. What the executor stores is a function, so the slot keeps its declared type.
// The loop reads the field 160,000 times. Without the fact each read tests the object first: 160,000 branches more.
// COUNT: branches <= 750000
class Call {
  resolve: ((v: number) => void) | undefined = undefined;
  promise: Promise<number>;
  constructor() {
    this.promise = new Promise<number>(r => {
      this.resolve = r;
    });
  }
}
export function settle(list: Call[], values: number[]): void {
  for (let j = 0; j < list.length; j++) list[j]!.resolve!(values[j]!);
}
const list: Call[] = [];
const values: number[] = [];
for (let i = 0; i < 16; i++) {
  list.push(new Call());
  values.push(i);
}
for (let turn = 0; turn < 10000; turn++) settle(list, values);
let sum = 0;
for (const v of await Promise.all(list.map(c => c.promise))) sum += v;
console.log(sum);
