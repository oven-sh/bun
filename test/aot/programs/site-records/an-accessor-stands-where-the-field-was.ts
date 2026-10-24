// A field of an object becomes a getter, a setter, both, a hidden or a read-only property. The reads and stores that expect the field do what the property says.
class Account {
  owner = "owner";
  balance = 100;
}

const trail: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function balanceOf(account: Account): number {
  return account.balance;
}
function ownerOf(account: Account): string {
  return account.owner;
}
function deposit(account: Account, amount: number): void {
  account.balance = amount;
}
function add(account: Account, amount: number): number {
  return (account.balance += amount);
}
function look(mark: string, account: Account): void {
  console.log(mark + ":", attempt(() => balanceOf(account)), attempt(() => ownerOf(account)), attempt(() => deposit(account, 7)), attempt(() => balanceOf(account)), attempt(() => add(account, 1)), Object.keys(account).join(), trail.splice(0).join(";"));
}

const honest = new Account();
look("honest", honest);

const withGetter = new Account();
Object.defineProperty(withGetter, "balance", {
  get() {
    trail.push("get on " + (this === withGetter ? "itself" : "another"));
    return 55;
  },
  configurable: true,
  enumerable: true,
});
look("getter alone", withGetter);

const withBoth = new Account();
let kept = 1;
Object.defineProperty(withBoth, "balance", {
  get() {
    trail.push("get");
    return kept;
  },
  set(value: number) {
    trail.push("set " + value + " on " + (this === withBoth ? "itself" : "another"));
    kept = value * 2;
  },
  configurable: true,
});
look("getter and setter", withBoth);
look("honest", honest);

const withSetter = new Account();
Object.defineProperty(withSetter, "balance", {
  set(value: number) {
    trail.push("set " + value);
  },
});
look("setter alone", withSetter);

const throwing = new Account();
Object.defineProperty(throwing, "balance", {
  get() {
    throw new RangeError("no balance");
  },
  set() {
    throw new SyntaxError("no deposit");
  },
});
look("both throw", throwing);

const lazy = new Account();
Object.defineProperty(lazy, "balance", {
  get() {
    trail.push("computed");
    Object.defineProperty(this, "balance", { value: 9, writable: true, enumerable: true, configurable: true });
    return 9;
  },
  configurable: true,
  enumerable: true,
});
look("a getter that replaces itself", lazy);
look("after it did", lazy);

const readOnly = new Account();
Object.defineProperty(readOnly, "balance", { writable: false });
look("read-only", readOnly);

const hidden = new Account();
Object.defineProperty(hidden, "balance", { enumerable: false });
look("hidden", hidden);

const fixed = new Account();
Object.defineProperty(fixed, "balance", { configurable: false });
look("fixed", fixed);
console.log("delete of a fixed field:", attempt(() => delete (fixed as any).balance), balanceOf(fixed));

Object.defineProperty(withGetter, "balance", { value: 3, writable: true });
look("a field again", withGetter);

const above = new Account();
delete (above as any).balance;
Object.defineProperty(Account.prototype, "balance", {
  get() {
    trail.push("get above for " + (this as Account).owner);
    return -1;
  },
  set(value: number) {
    trail.push("set above " + value);
  },
  configurable: true,
});
look("accessor on the prototype, field deleted", above);
look("accessor on the prototype, field present", honest);
look("accessor on the prototype, a new object", new Account());
delete (Account.prototype as any).balance;
look("accessor gone", above);

export {};
