const log: string[] = [];
let kept: any;
async function work(amount: number): Promise<number> {
  if (amount % 3 === 0) throw new Error("no " + amount);
  return amount * 2;
}
function make(amount: number): (error: Error) => void {
  if (amount === 3) {
    kept.then = function (onFulfilled: any, onRejected: any) {
      log.push("own then");
      return Promise.prototype.then.call(this, onFulfilled, onRejected);
    };
  }
  return error => {
    log.push("caught " + error.message);
  };
}
function run(amount: number): void {
  (kept = work(amount)).catch(make(amount));
}
const first = Number(process.argv[2] ?? 3);
run(first);
run(first + 3);
setTimeout(() => console.log(log.join("\n")), 5);
