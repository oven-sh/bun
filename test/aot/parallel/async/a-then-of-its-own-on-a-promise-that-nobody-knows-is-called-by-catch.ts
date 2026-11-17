const log: string[] = [];
const makers: ((amount: number) => any)[] = [
  amount => Promise.reject(new Error("no " + amount)),
  amount => {
    const promise: any = Promise.reject(new Error("no " + amount));
    promise.then = function (onFulfilled: any, onRejected: any) { log.push("own then"); return Promise.prototype.then.call(this, onFulfilled, onRejected); };
    return promise;
  },
];
function run(amount: number): void {
  makers[amount % 2](amount).catch((error: Error) => log.push("caught " + error.message));
}
const first = Number(process.argv[2] ?? 3);
run(first); run(first + 1);
setTimeout(() => console.log(log.join("\n")), 5);
