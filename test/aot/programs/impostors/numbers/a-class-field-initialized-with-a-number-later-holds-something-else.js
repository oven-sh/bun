function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

class Account {
  balance = 0;
  #secret = 0;
  static opened = 0;

  deposit(amount) {
    this.balance += amount;
    this.#secret += amount;
    Account.opened += 1;
    return this.balance;
  }

  report() {
    return [this.balance, this.balance + 1, this.balance * 2, this.balance | 0, this.#secret, this.#secret + 1, typeof this.balance];
  }

  overwrite(value) {
    this.balance = value;
    this.#secret = value;
  }
}

class Savings extends Account {
  balance = "none yet";
}

const honest = new Account();
for (let i = 0; i < 2000; i++) honest.deposit(1);
attempt("after 2000 deposits", () => honest.report());

for (const amount of ["5", 0.5, -0, null, undefined, true, 5n, NaN, 2147483647, [5], { valueOf: () => 5 }, Symbol("s")]) {
  attempt("a deposit of " + show(amount), () => {
    const account = new Account();
    account.deposit(1);
    account.deposit(amount);
    return account.report();
  });
  attempt("then an honest deposit after " + show(amount), () => {
    const account = new Account();
    account.deposit(amount);
    account.deposit(1);
    return account.report();
  });
  attempt("overwritten with " + show(amount), () => {
    const account = new Account();
    account.overwrite(amount);
    return account.report();
  });
}

attempt("a subclass redefines the field", () => new Savings().report());
attempt("a subclass redefines the field and deposits", () => {
  const savings = new Savings();
  savings.deposit(1);
  return savings.report();
});
attempt("the field is deleted", () => {
  const account = new Account();
  delete account.balance;
  return [account.report(), account.deposit(1)];
});
attempt("the field becomes an accessor", () => {
  const account = new Account();
  Object.defineProperty(account, "balance", { get: () => "from a getter", set() {} });
  return [account.report(), account.deposit(1)];
});
attempt("the method runs on another object", () => Account.prototype.deposit.call({ balance: "x" }, 1));
attempt("the honest account afterwards", () => [honest.deposit(1), honest.report()]);
