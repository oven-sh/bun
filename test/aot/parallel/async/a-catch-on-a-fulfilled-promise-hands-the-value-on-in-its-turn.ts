const log: string[] = [];
async function work(amount: number): Promise<number> {
  return amount * 2;
}
const makers: ((amount: number) => any)[] = [amount => Promise.resolve(amount), amount => work(amount)];
function run(amount: number): void {
  Promise.resolve().then(() => log.push("first beside " + amount)).then(() => log.push("second beside " + amount)).then(() => log.push("third beside " + amount));
  makers[amount % 2](amount)
    .catch(() => log.push("never"))
    .then((value: number) => log.push("unknown receiver gives " + value));
  work(amount)
    .catch(() => log.push("never"))
    .then(value => log.push("async call gives " + value));
  queueMicrotask(() => log.push("microtask " + amount));
}
const first = Number(process.argv[2] ?? 3);
run(first);
run(first + 1);
setTimeout(() => console.log(log.join("\n")), 5);
