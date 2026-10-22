function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

type Step = (n: number) => number;

function once(f: Step): number {
  return f(1) + 1;
}

function eachOf(f: Step): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += f(i);
  return sum;
}

class Account {
  balance = 10;
  owner: string;
  constructor(owner: string) {
    this.owner = owner;
  }
  deposit(amount: number): number {
    this.balance += amount;
    return this.balance;
  }
  title(): string {
    return this.owner.toUpperCase() + this.owner.length;
  }
}

function increment(n: number): number {
  return n + 1;
}

class Made {
  constructor(public n: number) {}
}

function honest(label: string): void {
  const account = new Account("ann");
  console.log(label, once(increment), once(n => n * 2), eachOf(increment), account.deposit(1), account.deposit(0.5), account.title());
}

const steps: [string, () => any][] = [
  ["a function", () => (n: number) => n + 1],
  ["answers a string", () => (n: number) => String(n)],
  ["answers nothing", () => () => undefined],
  ["answers a bigint", () => () => 1n],
  ["answers negative zero", () => () => -0],
  ["answers an object", () => () => ({ valueOf: () => (log.push("valueOf"), 5) })],
  ["async", () => async (n: number) => n],
  ["a generator function", () => function* (n: number) { yield n; }],
  ["a class", () => Made],
  ["bound", () => increment.bind(null)],
  ["bound with an argument", () => ((a: number, n: number) => a + n).bind(null, 10)],
  ["a proxy", () => new Proxy(increment, {})],
  ["a proxy that traps", () => new Proxy(increment, { apply: (t, self, args) => (log.push("apply:" + args.length), 100) })],
  ["an object with call", () => ({ call: () => 1, apply: () => 2 })],
  ["Math.sqrt", () => Math.sqrt],
  ["parseInt", () => parseInt],
  ["String", () => String],
  ["Symbol", () => Symbol],
  ["a method taken off", () => new Account("x").deposit],
  ["null", () => null],
  ["a number", () => 5],
];

const amounts: [string, () => any][] = [
  ["a number", () => 3],
  ["a string", () => "3"],
  ["a bigint", () => 3n],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
  ["valueOf", () => ({ valueOf: () => (log.push("valueOf"), 3) })],
];

const owners: [string, () => any][] = [
  ["a string", () => "eve"],
  ["a number", () => 7],
  ["null", () => null],
  ["an array", () => ["e", "v"]],
  ["a look-alike", () => ({ toUpperCase: () => 5, length: "long" })],
];

const receivers: [string, () => any][] = [
  ["a literal", () => ({ balance: 1 })],
  ["a string balance", () => ({ balance: "1" })],
  ["no balance", () => ({})],
  ["accessors", () => ({ get balance() { log.push("get"); return 1; }, set balance(v: number) { log.push("set:" + v); } })],
  ["frozen", () => Object.freeze({ balance: 1 })],
  ["a number", () => 5],
  ["null", () => null],
  ["undefined", () => undefined],
];

honest("honest before");
let warm = 0;
const busy = new Account("busy");
for (let i = 0; i < 2000; i++) warm += once(increment) + eachOf(increment) + busy.deposit(1) + busy.title().length + new Account("a").balance;
console.log("2000 honest rounds", warm);

for (const [name, make] of steps) {
  attempt("once " + name, () => once(make()));
  attempt("eachOf " + name, () => eachOf(make()));
}
for (const [name, make] of amounts) {
  attempt("deposit " + name, () => {
    const account = new Account("cat");
    return [account.deposit(make()), account.balance, account.deposit(1)];
  });
}
for (const [name, make] of owners) {
  attempt("constructed with " + name, () => new Account(make()).title());
  attempt("owner stored as " + name, () => {
    const account = new Account("cat");
    account.owner = make();
    return account.title();
  });
}
const deposit: any = Account.prototype.deposit;
for (const [name, make] of receivers) {
  attempt("deposit.call " + name, () => deposit.call(make(), 2));
  attempt("deposit.apply " + name, () => deposit.apply(make(), [2]));
  attempt("deposit.bind " + name, () => deposit.bind(make())(2));
  attempt("Reflect.apply " + name, () => Reflect.apply(deposit, make(), [2]));
}

honest("honest after");
