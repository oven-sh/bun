const log: string[] = [];
class Derived<T> extends Promise<T> {}
const makers: ((amount: number) => any)[] = [amount => Promise.resolve(amount), amount => Derived.resolve(amount)];
function run(amount: number): void {
  const given = makers[amount % 2](amount).then((value: number) => value + 1);
  log.push("derived " + (given instanceof Derived));
  const caught = makers[amount % 2](amount).catch(() => 0);
  log.push("derived " + (caught instanceof Derived));
  given.then((value: number) => log.push("value " + value));
}
const first = Number(process.argv[2] ?? 3);
run(first); run(first + 1);
setTimeout(() => console.log(log.join("\n")), 5);
