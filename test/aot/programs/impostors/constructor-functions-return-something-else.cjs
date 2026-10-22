function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function Other() {
  this.amount = "other amount";
}
Other.prototype.double = function () {
  return "doubled by Other";
};

const kept = { amount: "kept amount" };
const answers = {
  nothing: undefined,
  number: 5,
  string: "text",
  null: null,
  boolean: false,
  symbol: Symbol.for("answer"),
  bigint: 5n,
  literal: { amount: "literal amount" },
  kept,
  other: new Other(),
  array: [1, 2],
  function: function answer() {},
  boxed: new Number(5),
  bare: Object.create(null),
};

function Account(amount, answer) {
  this.amount = amount;
  return answers[answer];
}
Account.prototype.double = function () {
  return this.amount * 2;
};

function Saver(amount, answer) {
  const result = Account.call(this, amount, answer);
  this.resultOfParent = typeof result;
}
Saver.prototype = Object.create(Account.prototype);
Saver.prototype.constructor = Saver;

function open(amount, answer) {
  return new Account(amount, answer);
}

function amountOf(account) {
  return account.amount;
}

function doubleOf(account) {
  return account.double();
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const account = open(i % 10, "nothing");
  sum += amountOf(account) + doubleOf(account);
}
console.log("2000 honest constructions", sum);

for (let round = 0; round < 2; round++) {
  for (const answer of Object.keys(answers)) {
    const label = "round " + round + ", returns " + answer;
    let made;
    attempt(label + ": made", () => ((made = open(21, answer)), typeof made));
    attempt(label + ": instanceof Account", () => made instanceof Account);
    attempt(label + ": is what was returned", () => made === answers[answer]);
    attempt(label + ": amount", () => amountOf(made));
    attempt(label + ": double()", () => doubleOf(made));
    attempt(label + ": through a child", () => new Saver(4, answer));
  }
  attempt("round " + round + ", honest again", () => doubleOf(open(21, "nothing")));
}

attempt("two constructions give the kept object twice", () => open(1, "kept") === open(2, "kept"));
attempt("the kept object was never stored to", () => kept);
attempt("Reflect.construct follows the same rule", () => Reflect.construct(Account, [1, "literal"]));
attempt("and for a primitive", () => Reflect.construct(Account, [1, "number"]));
