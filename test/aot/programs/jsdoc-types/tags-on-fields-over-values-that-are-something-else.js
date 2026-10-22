/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

/**
 * @param {string} label
 * @param {() => unknown} run
 */
function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

/** @typedef {{ x: number, y: number }} Point */

class Account {
  /** @type {number} */
  balance = JSON.parse('"100"');

  /** @type {string} */
  owner = JSON.parse("7");

  /** @type {number[]} */
  history = JSON.parse('"none"');

  /** @type {Point} */
  place = JSON.parse("null");

  /** @type {number} */
  static count = JSON.parse('"zero"');

  /** @type {number} */
  #hidden = JSON.parse('"hidden"');

  /** @param {string} text */
  constructor(text) {
    /** @type {number} */
    this.limit = JSON.parse(text);
    /** @type {Point} */
    this.home = JSON.parse('{"x":' + text + ',"y":2}');
  }

  /** @returns {number} */
  total() {
    return this.balance + this.limit;
  }

  /** @returns {number} */
  hidden() {
    return this.#hidden + 1;
  }

  /** @returns {number} */
  far() {
    return this.home.x + this.home.y;
  }
}

class Honest {
  /** @type {number} */
  n = JSON.parse("1");
  /** @type {Point} */
  p = JSON.parse('{"x":1,"y":2}');
  /** @returns {number} */
  all() {
    return this.n + this.p.x + this.p.y;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Honest().all();
console.log("2000 honest rounds: " + warm);

attempt("fields as they were made", () => {
  const a = new Account("5");
  return [a.balance, a.owner, a.history, a.place, a.limit, Account.count, Object.keys(a).join(), JSON.stringify(a)];
});
attempt("arithmetic", () => {
  const a = new Account("5");
  return [a.balance + 1, a.balance * 2, a.owner + 1, a.limit + 1, Account.count + 1, a.total(), a.hidden(), a.far()];
});
for (const text of ["5", '"5"', "null", "[5]", "true", "{}"]) {
  attempt("the constructor parses " + text, () => {
    const a = new Account(text);
    return [a.limit, a.limit + 1, a.total(), a.home.x, a.far()];
  });
}
attempt("a member of a field that is null", () => new Account("5").place.x);
attempt("the list that is a text", () => [new Account("5").history.length, new Account("5").history[0]]);
attempt("the list that is a text, pushed to", () => new Account("5").history.push(1));
attempt("the text that is a number, its length", () => new Account("5").owner.length);
attempt("stored honestly afterwards", () => {
  const a = new Account('"5"');
  a.balance = 1;
  a.limit = 2;
  a.home = { x: 3, y: 4 };
  return [a.total(), a.far(), JSON.stringify(a)];
});
attempt("honest again", () => new Honest().all());

export {};
