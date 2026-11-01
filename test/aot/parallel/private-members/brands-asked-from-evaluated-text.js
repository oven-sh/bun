// Nothing in the text of these classes asks whether an object has their private names: every method reads them off `this`. The questions come in evaluated text, some of it put together at run time, and from methods called on something else.
const lines = [];
function attempt(name, run) {
  try {
    lines.push(name + ": " + String(run()));
  } catch (error) {
    lines.push(name + ": " + error.constructor.name);
  }
}
const hash = String.fromCharCode(30 + lines.length + 5);

class Account {
  #balance = 10;
  #owner;
  constructor(owner) {
    this.#owner = owner;
  }
  deposit(amount) {
    this.#balance += amount;
    return this.#balance;
  }
  owner() {
    return this.#owner;
  }
  ask(text, given) {
    return eval(text);
  }
  static ask(text, given) {
    return eval(text);
  }
  askInArrow(text, given) {
    return (() => eval(text))();
  }
  askTwice(text, given) {
    return eval("eval(text)");
  }
}
class OneField {
  #only = 1;
  read() {
    return this.#only;
  }
  ask(text, given) {
    return eval(text);
  }
}
class SameName {
  #balance = -1;
  read() {
    return this.#balance;
  }
  ask(text, given) {
    return eval(text);
  }
}
class WithMethod {
  #twice() {
    return 2 * this.#seed;
  }
  #seed = 21;
  run() {
    return this.#twice();
  }
  ask(text, given) {
    return eval(text);
  }
}

let sum = 0;
let account = new Account("first");
for (let i = 0; i < 2000; i++) {
  account = new Account("owner " + (i & 3));
  sum += account.deposit(i & 7) + new OneField().read() + new SameName().read() + new WithMethod().run();
}
lines.push("sum: " + sum + " " + account.owner());

const others = {
  object: {},
  sameName: new SameName(),
  oneField: new OneField(),
  below: Object.create(account),
  proxy: new Proxy(account, {}),
  array: [],
  callable: function () {},
  account,
  another: new Account("another"),
};
for (const [name, given] of Object.entries(others)) {
  attempt("in, " + name, () => Account.ask("#balance in given", given));
  attempt("in, built, " + name, () => Account.ask(hash + "owner in given", given));
  attempt("read, " + name, () => Account.ask("given.#balance", given));
  attempt("read, built, " + name, () => account.ask("given." + hash + "balance", given));
  attempt("write, " + name, () => account.askInArrow("given." + hash + "balance = 5", given));
  attempt("add, " + name, () => account.askTwice("given." + hash + "balance += 1", given));
  attempt("other class, " + name, () => others.sameName.ask("given." + hash + "balance", given));
  attempt("one field, " + name, () => others.oneField.ask(hash + "only in given", given));
  attempt("method, " + name, () => new WithMethod().ask(hash + "twice in given", given));
  attempt("deposit on, " + name, () => Account.prototype.deposit.call(given, 1));
  attempt("owner of, " + name, () => Account.prototype.owner.call(given));
  attempt("read on, " + name, () => OneField.prototype.read.call(given));
  attempt("run on, " + name, () => WithMethod.prototype.run.call(given));
}
for (const given of [null, undefined, 5, "text", Symbol.iterator, 5n, true]) {
  attempt("in, " + String(given), () => Account.ask(hash + "balance in given", given));
  attempt("read, " + String(given), () => Account.ask("given." + hash + "balance", given));
  attempt("deposit on, " + String(given), () => Account.prototype.deposit.call(given, 1));
}
attempt("this", () => account.ask("this." + hash + "balance + this." + hash + "owner"));
attempt("this is something else", () => account.ask.call({}, "this." + hash + "balance"));
attempt("in this, something else", () => account.ask.call({}, hash + "balance in this"));
attempt("a class in the text", () =>
  account.ask("(class { static read(o) { return o." + hash + "balance; } }).read(this)"),
);
attempt("a class in the text, something else", () =>
  account.ask("(class { static read(o) { return o." + hash + "balance; } }).read({})"),
);
attempt("a function in the text, kept", () => {
  const has = account.ask("(o => " + hash + "balance in o)");
  return [has(account), has({}), has(others.sameName), has(others.another)];
});
attempt("a private method from the text", () => new WithMethod().ask("this." + hash + "twice()"));
attempt("a private method stored over", () => new WithMethod().ask("this." + hash + "twice = 1"));
attempt("a name that is not there", () => account.ask("this." + hash + "missing"));
attempt("deleted", () => account.ask("delete this." + hash + "balance"));
attempt("indirect", () => (0, eval)(hash + "balance in {}"));
attempt("a new function", () => new Function("o", "return " + hash + "balance in o")({}));
console.log(lines.join("\n"));
