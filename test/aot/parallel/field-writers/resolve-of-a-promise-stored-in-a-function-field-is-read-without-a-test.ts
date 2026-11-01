// The resolve function that `new Promise` hands its executor is stored into a field typed as a function. Flow knows it is a function, so the field holds its declared type
// from birth: a read of it is one load, with no test of the object in front. The batching pattern: each pending call keeps its resolve, and one settle loop calls them all.
// The loop reads the field 160,000 times. Without the fact each read tests the object first: 160,000 branches more.
// COUNT: branches <= 750000
class Call {
  resolve!: (v: number) => void;
  promise: Promise<number>;
  constructor() {
    this.promise = new Promise<number>(r => {
      this.resolve = r;
    });
  }
}
export function settle(list: Call[], values: number[]): void {
  for (let j = 0; j < list.length; j++) list[j]!.resolve(values[j]!);
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
