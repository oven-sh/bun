const log: string[] = [];
async function work(amount: number): Promise<number> {
  if (amount > 5) await null;
  if (amount % 3 === 0) throw new Error("no " + amount);
  return amount * 2;
}
function run(amount: number): Promise<string> {
  Promise.resolve().then(() => log.push("beside " + amount)).then(() => log.push("beside again " + amount));
  return work(amount)
    .then(value => {
      log.push("then " + value);
      if (value === 8) throw new Error("eight");
      return "value " + value;
    })
    .catch(error => {
      log.push("caught " + error.message);
      return "error " + error.message;
    });
}
const first = Number(process.argv[2] ?? 3);
const all: Promise<string>[] = [];
for (let amount = first; amount < first + 6; amount++) all.push(run(amount));
Promise.all(all).then(answers => console.log(log.join("\n") + "\n" + answers.join("\n")));
