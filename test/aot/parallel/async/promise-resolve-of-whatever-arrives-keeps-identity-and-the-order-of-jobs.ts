const log: string[] = [];
class Below<T> extends Promise<T> {}
async function work(amount: number): Promise<number> { if (amount % 2) await null; return amount; }
const holders: any[] = [Promise, Promise, Below];
const values: ((amount: number) => any)[] = [
  amount => amount,
  amount => work(amount),
  amount => Promise.reject(new Error("no " + amount)),
  amount => ({ then(f: (value: string) => void) { log.push("then called " + amount); f("thenable " + amount); } }),
  amount => Below.resolve(amount),
  amount => ({ amount }),
  amount => { const own: any = Promise.resolve(amount); own.constructor = Below; return own; },
  () => undefined,
];
function run(amount: number): void {
  const value = values[amount % values.length](amount);
  const holder = holders[amount % holders.length];
  const given = holder.resolve(value);
  log.push(amount + " same " + (given === value) + " below " + (given instanceof Below));
  Promise.resolve().then(() => log.push("beside " + amount));
  given.then((got: any) => log.push(amount + " gives " + (typeof got === "object" ? JSON.stringify(got) : String(got))), (error: Error) => log.push(amount + " fails " + error.message));
}
const first = Number(process.argv[2] ?? 3);
for (let amount = first; amount < first + 24; amount++) run(amount);
setTimeout(() => console.log(log.join("\n")), 5);
