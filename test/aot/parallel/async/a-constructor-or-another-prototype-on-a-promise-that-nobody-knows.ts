const log: string[] = [];
class Derived<T> extends Promise<T> {}
const other = { __proto__: Promise.prototype, then(this: any, f: any, g: any) { log.push("then of another prototype"); return Promise.prototype.then.call(this, f, g); } };
const makers: ((amount: number) => any)[] = [
  amount => Promise.resolve(amount),
  amount => { const promise: any = Promise.resolve(amount); promise.constructor = { [Symbol.species]: Derived }; return promise; },
  amount => Object.setPrototypeOf(Promise.resolve(amount), other),
];
function run(amount: number): void {
  const given = makers[amount % 3](amount).then((value: number) => value + 1);
  log.push(amount % 3 + " derived " + (given instanceof Derived));
  given.then((value: number) => log.push("value " + value));
}
const first = Number(process.argv[2] ?? 3);
run(first); run(first + 1); run(first + 2);
setTimeout(() => console.log(log.join("\n")), 5);
