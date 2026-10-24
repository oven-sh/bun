function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Account {
  /** @type {number} */
  balance = "100";

  /** @type {string} */
  owner = 7;

  /** @type {number[]} */
  history = "none";

  /** @type {{ x: number, y: number }} */
  place = null;

  /** @type {number} */
  never;

  /** @type {number} */
  static count = "zero";

  /** @type {number} */
  #hidden = "hidden";

  constructor() {
    /** @type {number} */
    this.limit = [5];
    /** @type {boolean} */
    this.open = "yes";
  }

  /** @returns {number} */
  total() {
    return this.balance + this.limit;
  }

  /** @returns {number} */
  hidden() {
    return this.#hidden + 1;
  }

  /** @param {number} amount */
  deposit(amount) {
    this.balance += amount;
    return this.balance;
  }
}

class Honest {
  /** @type {number} */
  n = 1;
  /** @type {string} */
  s = "s";
  /** @returns {number} */
  next() {
    return this.n + 1;
  }
}

class Late {
  /** @type {number} */
  n = 1;
  /** @returns {number} */
  next() {
    return this.n + 1;
  }
}

class Base {
  /** @type {number} */
  value = 1;
  /** @returns {number} */
  twice() {
    return this.value * 2;
  }
}

class Heir extends Base {
  /** @type {number} */
  value = "heir";
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Honest().next() + new Late().next() + new Base().twice();
console.log("2000 honest rounds: " + warm);

attempt("fields as they were made", () => {
  const a = new Account();
  return [a.balance, a.owner, a.history, a.place, a.never, a.limit, a.open, Account.count, Object.keys(a).join(), JSON.stringify(a)];
});
attempt("their kinds", () => {
  const a = new Account();
  return [typeof a.balance, typeof a.owner, typeof a.history, typeof a.place, typeof a.never, typeof a.limit, typeof a.open, typeof Account.count];
});
attempt("arithmetic", () => {
  const a = new Account();
  return [a.balance + 1, a.balance * 2, a.owner + 1, a.never + 1, a.limit + 1, Account.count + 1, a.total(), a.hidden()];
});
attempt("updates", () => {
  const a = new Account();
  return [a.deposit(1), a.deposit("2"), a.balance, ++a.never, a.limit++, a.limit, ++Account.count];
});
attempt("a member of a field that is null", () => new Account().place.x);
attempt("the list that is a text", () => {
  const a = new Account();
  return [a.history.length, a.history[0], [...a.history].length];
});
attempt("the list that is a text, pushed to", () => new Account().history.push(1));
attempt("the text that is a number", () => new Account().owner.length);
attempt("stored honestly afterwards", () => {
  const a = new Account();
  a.balance = 1;
  a.limit = 2;
  a.owner = "o";
  a.place = { x: 1, y: 2 };
  return [a.total(), a.owner.length, a.place.x + a.place.y, JSON.stringify(a)];
});
attempt("an honest class gets other values later", () => {
  const late = new Late();
  const seen = [late.next()];
  for (const value of ["1", null, undefined, [1], { valueOf: () => 1 }, 1n === 1n, 2]) {
    late.n = value;
    seen.push(late.next());
  }
  return seen;
});
attempt("a subclass declares the same type and stores another kind", () => [new Heir().value, new Heir().twice(), new Base().twice(), Object.keys(new Heir()).join()]);
attempt("honest again", () => [new Honest().next(), new Late().next(), new Base().twice()]);
