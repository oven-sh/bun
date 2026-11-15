const log: string[] = [];
class Derived<T> extends Promise<T> {}
async function work(amount: number): Promise<number> {
  return amount * 2;
}
function run(amount: number): void {
  const promise = work(amount);
  if (amount === 3) (promise as any).constructor = { [Symbol.species]: Derived };
  const given = promise.then(value => value + 1);
  log.push("derived " + (given instanceof Derived));
  given.then(value => log.push("value " + value));
}
const first = Number(process.argv[2] ?? 3);
run(first);
run(first + 1);
setTimeout(() => console.log(log.join("\n")), 5);
