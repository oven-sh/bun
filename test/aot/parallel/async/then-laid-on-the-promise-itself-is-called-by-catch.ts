const log: string[] = [];
async function work(amount: number): Promise<number> {
  if (amount % 3 === 0) throw new Error("no " + amount);
  return amount * 2;
}
function run(amount: number): void {
  const promise = work(amount);
  (promise as any).then = function (onFulfilled: any, onRejected: any) {
    log.push("own then " + amount);
    return Promise.prototype.then.call(this, onFulfilled, onRejected);
  };
  promise.catch(error => {
    log.push("caught " + error.message);
  });
}
const first = Number(process.argv[2] ?? 3);
run(first);
run(first + 1);
setTimeout(() => console.log(log.join("\n")), 5);
