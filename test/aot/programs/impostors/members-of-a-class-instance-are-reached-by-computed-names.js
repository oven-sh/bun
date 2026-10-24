function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

class Account {
  #secret = "hidden";
  owner = "ada";
  balance = 10;
  static bank = "first";

  get label() {
    return this.owner + ":" + this.balance;
  }

  set label(value) {
    this.owner = value;
  }

  get readOnly() {
    return "read only";
  }

  describe() {
    return "account of " + this.owner;
  }

  deposit(amount) {
    this.balance += amount;
    return this.balance;
  }

  reveal() {
    return this.#secret;
  }

  static open() {
    return new Account();
  }
}

function read(account, name) {
  return account[name];
}

function store(account, name, value) {
  account[name] = value;
}

function call(account, name, argument) {
  return account[name](argument);
}

function remove(account, name) {
  return delete account[name];
}

function has(account, name) {
  return [name in account, Object.hasOwn(account, name)];
}

function summary(account) {
  const parts = [];
  for (const use of [() => account.owner, () => account.balance, () => account.label, () => account.describe(), () => account.deposit(1), () => account.reveal(), () => Object.keys(account).join(",")]) {
    try {
      parts.push(show(use()));
    } catch (error) {
      parts.push("threw " + error.constructor.name);
    }
  }
  return parts.join(" | ");
}

for (let i = 0; i < 2000; i++) {
  const account = new Account();
  read(account, i % 2 ? "owner" : "balance");
  store(account, "owner", "grace");
  call(account, "describe");
  has(account, "owner");
  account.describe();
  account.deposit(1);
  account.label;
}

const names = ["'owner'", "'own' + 'er'", "'balance'", "'label'", "'readOnly'", "'describe'", "'deposit'", "'reveal'", "'#secret'", "'secret'", "'bank'", "'open'", "'constructor'", "'__proto__'", "'prototype'", "'toString'", "'hasOwnProperty'", "'missing'", "''", "0", "null", "['owner']", "new String('owner')", "{ toString() { return 'describe'; } }", "Symbol('owner')", "Symbol.toStringTag"];

for (const name of names) {
  attempt("read " + name, () => {
    const found = read(new Account(), make(name));
    return typeof found === "function" ? "function " + found.name : found === Account.prototype ? "Account.prototype" : found;
  });
  attempt("in and own " + name, () => has(new Account(), make(name)));
  attempt("call " + name, () => call(new Account(), make(name), 5));
  let account = new Account();
  let outcome = "";
  try {
    store(account, make(name), "stored");
  } catch (error) {
    outcome = "(threw " + error.constructor.name + ") ";
  }
  console.log("after a store of a text by " + name + " -> " + outcome + summary(account));
  account = new Account();
  outcome = "";
  try {
    store(account, make(name), () => "replaced");
  } catch (error) {
    outcome = "(threw " + error.constructor.name + ") ";
  }
  console.log("after a store of a function by " + name + " -> " + outcome + summary(account));
  account = new Account();
  try {
    outcome = "(" + remove(account, make(name)) + ") ";
  } catch (error) {
    outcome = "(threw " + error.constructor.name + ") ";
  }
  console.log("after a delete by " + name + " -> " + outcome + summary(account));
}

attempt("a store by name into the prototype changes every instance", () => {
  const before = new Account();
  const original = Account.prototype.describe;
  store(Account.prototype, make("'describe'"), function () { return "patched for " + this.owner; });
  const result = [before.describe(), new Account().describe(), call(before, "describe")];
  Account.prototype.describe = original;
  return result.concat(before.describe());
});
attempt("a delete by name from the prototype", () => {
  const original = Account.prototype.describe;
  remove(Account.prototype, make("'describe'"));
  let result;
  try {
    result = new Account().describe();
  } catch (error) {
    result = error.constructor.name;
  }
  Account.prototype.describe = original;
  return [result, new Account().describe()];
});
attempt("static members by name", () => [read(Account, make("'bank'")), call(Account, make("'open'")) instanceof Account, read(Account, make("'name'")), read(Account, make("'length'"))]);
attempt("honest again", () => summary(new Account()));
