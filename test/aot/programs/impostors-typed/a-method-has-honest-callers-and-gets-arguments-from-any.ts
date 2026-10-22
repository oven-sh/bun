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
  balance = 0;
  history: number[] = [];
  owner: string;

  constructor(owner: string) {
    this.owner = owner;
  }

  deposit(amount: number): number {
    this.balance += amount;
    this.history.push(amount);
    return this.balance;
  }

  rename(owner: string): number {
    this.owner = owner;
    return this.owner.length;
  }

  depositAll(amounts: number[]): number {
    for (const amount of amounts) this.deposit(amount);
    return this.balance;
  }

  largest(): number {
    let best = -Infinity;
    for (let i = 0; i < this.history.length; i++) if (this.history[i] > best) best = this.history[i];
    return best;
  }

  static merged(a: Account, b: Account): number {
    return a.balance + b.balance;
  }
}

function honest(label: string): void {
  const account = new Account("ann");
  const other = new Account("bob");
  console.log(label, account.deposit(5), account.deposit(2.5), other.deposit(1), account.rename("anna"), account.depositAll([1, 2]), account.largest(), Account.merged(account, other));
}

const amounts = [
  "3",
  "'3'",
  "-0",
  "NaN",
  "3n",
  "null",
  "undefined",
  "true",
  "[3]",
  "{ valueOf() { note('valueOf'); return 3; } }",
  "{ [Symbol.toPrimitive](hint) { note(hint); return 3; } }",
  "Symbol()",
];

honest("honest before");
const busy = new Account("busy");
for (let i = 0; i < 2000; i++) busy.deposit(i);
console.log("2000 honest deposits", busy.balance, busy.history.length, busy.largest());

for (const text of amounts) {
  const account = new Account("cat");
  account.deposit(1);
  attempt("deposit " + text, () => account.deposit(hidden(text)));
  attempt("  balance", () => account.balance);
  attempt("  balance + 1", () => account.balance + 1);
  attempt("  history", () => account.history);
  attempt("  largest", () => account.largest());
  attempt("  honest deposit afterwards", () => account.deposit(1));
  attempt("  merged", () => Account.merged(account, new Account("dan")));
}

for (const text of ["'eve'", "7", "null", "undefined", "['e', 'v']", "new String('eve')", "{ length: 'long' }", "Symbol()"]) {
  const account = new Account("cat");
  attempt("rename " + text, () => account.rename(hidden(text)));
  attempt("  owner", () => account.owner);
  attempt("  owner + '!'", () => account.owner + "!");
  attempt("  owner.toUpperCase()", () => account.owner.toUpperCase());
}

for (const text of ["[1, 2]", "['1', '2']", "[1, , 2]", "new Set([1, 2])", "'12'", "{ length: 1, 0: 1 }", "null", "5", "(function* () { yield 4; yield '5'; })()"]) {
  const account = new Account("cat");
  attempt("depositAll " + text, () => account.depositAll(hidden(text)));
  attempt("  history", () => account.history);
}

for (const text of ["{ balance: 5 }", "{ balance: '5' }", "{}", "{ get balance() { note('get'); return 5; } }", "null", "5", "new Proxy({}, { get() { return 9; } })"]) {
  attempt("merged " + text, () => Account.merged(hidden(text), new Account("dan")));
  attempt("merged the other way " + text, () => Account.merged(new Account("dan"), hidden(text)));
}

honest("honest after");
