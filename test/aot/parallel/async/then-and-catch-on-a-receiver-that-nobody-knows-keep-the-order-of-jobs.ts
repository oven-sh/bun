const log: string[] = [];
const makers: ((amount: number) => any)[] = [
  amount => Promise.resolve(amount),
  amount => Promise.reject(new Error("no " + amount)),
  amount => new Promise(resolve => setTimeout(resolve, 1, amount)),
  async amount => { await null; if (amount % 2) throw new Error("odd " + amount); return amount; },
];
function run(amount: number): any {
  Promise.resolve().then(() => log.push("beside " + amount)).then(() => log.push("beside again " + amount));
  return makers[amount % makers.length](amount)
    .then((value: number) => { log.push("then " + value); return value + 1; })
    .catch((error: Error) => { log.push("caught " + error.message); return -1; });
}
const first = Number(process.argv[2] ?? 3);
const all: any[] = [];
for (let amount = first; amount < first + 8; amount++) all.push(run(amount));
Promise.all(all).then(answers => console.log(log.join("\n") + "\n" + answers.join(" ")));
