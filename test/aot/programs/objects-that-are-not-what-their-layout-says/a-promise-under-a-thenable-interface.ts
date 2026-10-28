// An interface with `then` takes a literal and a Promise
interface Thenable {
  then(f: (v: number) => void): unknown;
}
function tell(t: Thenable): string {
  return (t instanceof Promise) + "|" + typeof t.then + "|" + Object.keys(t).join();
}
const list: Thenable[] = [
  {
    then(f) {
      f(1);
      return 0;
    },
  },
  Promise.resolve(2),
];
for (let round = 0; round < 3; round++) for (const t of list) console.log(tell(t));
async function wait(t: Thenable) {
  return await (t as any);
}
for (const t of list) console.log(await wait(t));
