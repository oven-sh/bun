// The reject function that `new Promise` hands its executor, stored into a field typed as a function: the field holds its declared type from birth, and a read of it is one load.
// The loop reads the field 160,000 times. Without the fact each read tests the object first: 160,000 branches more.
// COUNT: branches <= 420000
class Call {
  reject!: (reason: Error) => void;
  promise: Promise<number>;
  constructor() {
    this.promise = new Promise<number>((_resolve, reject) => {
      this.reject = reject;
    });
  }
}
export function fail(list: Call[], reason: Error): void {
  for (let j = 0; j < list.length; j++) list[j]!.reject(reason);
}
const list: Call[] = [];
for (let i = 0; i < 16; i++) list.push(new Call());
const reason = new Error("batch failed");
for (let turn = 0; turn < 10000; turn++) fail(list, reason);
let failures = 0;
for (const result of await Promise.allSettled(list.map(c => c.promise))) {
  if (result.status === "rejected" && result.reason.message === "batch failed") failures++;
}
console.log(failures);
