const log: string[] = [];
const makers: ((amount: number) => any)[] = [
  amount => Promise.resolve(amount),
  amount => Promise.reject(new Error("no " + amount)),
  amount => new Promise(resolve => setTimeout(resolve, 1, amount)),
  amount => new Promise((_, reject) => queueMicrotask(() => reject(new Error("late " + amount)))),
  amount => ({ then(f: (value: number) => void) { log.push("own then " + amount); f(amount); } }),
];
function run(amount: number): any {
  const local = { amount };
  Promise.resolve().then(() => log.push("beside " + amount)).then(() => log.push("beside again " + amount));
  return makers[amount % makers.length](amount).then(
    function (value: number) { log.push("fulfilled " + value + " for " + local.amount); return value; },
    function (error: Error) { log.push("rejected " + error.message + " for " + local.amount); return -1; },
  );
}
const first = Number(process.argv[2] ?? 3);
const all: any[] = [];
for (let amount = first; amount < first + 10; amount++) all.push(run(amount));
setTimeout(() => Promise.all(all).then(answers => console.log(log.join("\n") + "\n" + answers.join(" "))), 10);
