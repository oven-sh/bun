const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

function Money(cents, currency) {
  this.cents = cents;
  this.currency = currency;
}
Money.prototype.format = function () {
  return (this.cents / 100).toFixed(2) + " " + this.currency;
};
Money.prototype.add = function (other) {
  return new Money(this.cents + other.cents, this.currency);
};

function formatOf(money) {
  return money.format();
}

function centsOf(money) {
  return money.cents;
}

function sumOf(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].cents;
  return total;
}

const text = '{"paid":{"cents":250,"currency":"USD"},"due":{"currency":"EUR","cents":1999},"odd":{"cents":"5","currency":"GBP"},"list":[{"cents":1,"currency":"USD"},{"cents":2.5,"currency":"USD"}]}';
const looksLikeMoney = value => typeof value === "object" && value !== null && "cents" in value && "currency" in value;

const revivers = [
  ["no reviver", undefined],
  ["calls the constructor", (key, value) => (looksLikeMoney(value) ? new Money(value.cents, value.currency) : value)],
  ["moves the parsed object under the prototype", (key, value) => (looksLikeMoney(value) ? Object.setPrototypeOf(value, Money.prototype) : value)],
  ["copies into Object.create", (key, value) => (looksLikeMoney(value) ? Object.assign(Object.create(Money.prototype), value) : value)],
  ["turns cents into strings", (key, value) => (key === "cents" ? String(value) : value)],
  ["drops cents", (key, value) => (key === "cents" ? undefined : value)],
  ["turns cents into getters", (key, value) => (looksLikeMoney(value) ? Object.defineProperty(value, "cents", { get() { log.push("get cents"); return 77; }, enumerable: true }) : value)],
  ["freezes everything", (key, value) => (typeof value === "object" && value !== null ? Object.freeze(value) : value)],
  ["changes a sibling that was not visited yet", function (key, value) { if (key === "paid") this.due = { cents: -1, currency: "changed" }; return value; }],
  ["deletes a sibling that was not visited yet", function (key, value) { if (key === "paid") delete this.due; return value; }],
  ["logs the order of the keys", (key, value) => (log.push(key === "" ? "(root)" : key), value)],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  const money = new Money(i % 300, "USD").add(new Money(1, "USD"));
  total += centsOf(money) + formatOf(money).length + sumOf([money, money]);
}
console.log("2000 honest sums", total);

for (const [label, reviver] of revivers) {
  let parsed;
  attempt(label + ": parse", () => ((parsed = JSON.parse(text, reviver)), Object.keys(parsed)));
  for (const name of ["paid", "due", "odd"]) {
    attempt(label + ", " + name, () => parsed[name]);
    attempt(label + ", " + name + ": instanceof Money", () => parsed[name] instanceof Money);
    attempt(label + ", " + name + ": cents", () => centsOf(parsed[name]));
    attempt(label + ", " + name + ": format()", () => formatOf(parsed[name]));
    attempt(label + ", " + name + ": the honest format with it as this", () => Money.prototype.format.call(parsed[name]));
    attempt(label + ", " + name + ": an honest one adds it", () => new Money(100, "USD").add(parsed[name]));
  }
  attempt(label + ": the sum of the list", () => sumOf(parsed.list));
  attempt(label + ": back to JSON", () => JSON.stringify(parsed));
  attempt("honest again", () => formatOf(new Money(5, "USD").add(new Money(6, "USD"))));
}
