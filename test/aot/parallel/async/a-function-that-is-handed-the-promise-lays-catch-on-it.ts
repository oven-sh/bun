const log: string[] = [];
async function work(amount: number): Promise<number> {
  if (amount % 3 === 0) throw new Error("no " + amount);
  return amount * 2;
}
const touchers: ((promise: any) => void)[] = [
  () => {},
  promise => {
    promise.catch = function (onRejected: any) {
      log.push("own catch");
      return Promise.prototype.catch.call(this, onRejected);
    };
  },
];
function run(amount: number): void {
  const promise = work(amount);
  touchers[amount % 2](promise);
  promise.catch(error => {
    log.push("caught " + error.message);
  });
}
const first = Number(process.argv[2] ?? 3);
run(first);
run(first + 3);
setTimeout(() => console.log(log.join("\n")), 5);
