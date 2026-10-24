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

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

class Account {
  balance = 10;
  history: number[] = [];

  deposit(amount: number): number {
    this.balance += amount;
    this.history.push(amount);
    return this.balance;
  }

  get doubled(): number {
    return this.balance * 2;
  }

  set doubled(value: number) {
    this.balance = value / 2;
  }

  describe(): string {
    return this.constructor.name + ":" + this.balance;
  }

  isAccount(): boolean {
    return this instanceof Account;
  }
}

class Savings extends Account {
  rate = 2;
  deposit(amount: number): number {
    return super.deposit(amount * this.rate);
  }
}

function honest(label: string): void {
  const account = new Account();
  const savings = new Savings();
  account.doubled = 8;
  console.log(label, account.deposit(1), savings.deposit(1), account.doubled, savings.doubled, account.describe(), savings.describe(), account.isAccount(), savings.isAccount());
}

const receivers = [
  "{ balance: 1, history: [] }",
  "{ history: [], balance: 1 }",
  "{ balance: '1', history: [] }",
  "{ balance: 1, history: { push(v) { note('push:' + v); } } }",
  "{ balance: 1 }",
  "{ get balance() { note('get'); return 1; }, set balance(v) { note('set:' + v); }, history: [] }",
  "Object.freeze({ balance: 1, history: [] })",
  "new Proxy({ balance: 1, history: [] }, { get(t, k, r) { note('get:' + String(k)); return Reflect.get(t, k, r); }, set(t, k, v, r) { note('set:' + String(k)); return Reflect.set(t, k, v, r); } })",
  "Object.create(null)",
  "[]",
  "function () {}",
  "5",
  "'text'",
  "null",
  "undefined",
];

honest("honest before");
const busy = new Account();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += busy.deposit(1) + busy.doubled;
console.log("2000 honest calls", warm, busy.describe());

const deposit: any = Account.prototype.deposit;
const describe: any = Account.prototype.describe;
const isAccount: any = Account.prototype.isAccount;
const savingsDeposit: any = Savings.prototype.deposit;
const doubled = Object.getOwnPropertyDescriptor(Account.prototype, "doubled") as { get: any; set: any };

for (const text of receivers) {
  attempt("deposit.call " + text, () => deposit.call(hidden(text), 2));
  attempt("deposit.apply " + text, () => deposit.apply(hidden(text), [2]));
  attempt("deposit.bind " + text, () => deposit.bind(hidden(text))(2));
  attempt("Reflect.apply " + text, () => Reflect.apply(deposit, hidden(text), [2]));
  attempt("savings deposit.call " + text, () => savingsDeposit.call(hidden(text), 2));
  attempt("describe.call " + text, () => describe.call(hidden(text)));
  attempt("isAccount.call " + text, () => isAccount.call(hidden(text)));
  attempt("getter.call " + text, () => doubled.get.call(hidden(text)));
  attempt("setter.call " + text, () => doubled.set.call(hidden(text), 6));
  attempt("borrowed as a member " + text, () => {
    const receiver = hidden(text);
    receiver.deposit = deposit;
    return receiver.deposit(2);
  });
  attempt("prototype swapped in " + text, () => {
    const receiver = hidden(text);
    Object.setPrototypeOf(receiver, Account.prototype);
    const typed: Account = receiver;
    return typed.deposit(2) + "/" + typed.doubled + "/" + typed.describe() + "/" + typed.isAccount();
  });
}

attempt("taken off and called bare", () => {
  const bare = new Account().deposit;
  return bare(1);
});
attempt("handed to map", () => [1, 2].map(new Account().deposit));
attempt("handed to map with a receiver", () => [1, 2].map(new Account().deposit, new Account()));
attempt("handed to map with an impostor receiver", () => [1, 2].map(new Account().deposit, hidden("{ balance: 'b', history: [] }")));

honest("honest after");
