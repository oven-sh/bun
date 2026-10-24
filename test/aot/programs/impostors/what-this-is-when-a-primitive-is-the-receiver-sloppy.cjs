const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

function kindOfNumber() {
  return [typeof this, this + 1, this | 0, this === 7, this == 7];
}
function kindOfText() {
  return [typeof this, this.charCodeAt(0), this === "abc", this + "", this.length];
}
function kindOfBoolean() {
  return [typeof this, this ? "truthy" : "falsy", this === false, !this];
}
function kindOfBigInt() {
  return [typeof this, this + 1n, this === 10n];
}
function kindOfSymbol() {
  return [typeof this, this.description, this === Symbol.iterator];
}
function kindOfNothing() {
  return [typeof this, this === undefined, this === null, this === globalThis];
}
function storesOnNumber() {
  this.x = 1;
  return [this.x, typeof this];
}
function comparesWithItself(other) {
  return [this === this, this === other, this == other];
}

const ways = [
  ["call", (f, receiver, ...list) => f.call(receiver, ...list)],
  ["apply", (f, receiver, ...list) => f.apply(receiver, list)],
  ["bind", (f, receiver, ...list) => f.bind(receiver, ...list)()],
  ["Reflect.apply", (f, receiver, ...list) => Reflect.apply(f, receiver, list)],
  ["the receiver given to forEach", (f, receiver, ...list) => { let result; [0].forEach(function () { result = f.apply(this, list); }, receiver); return result; }],
  ["the receiver given to Array.from", (f, receiver, ...list) => Array.from([0], function () { return f.apply(this, list); }, receiver)[0]],
];
for (const [label, invoke] of ways) {
  attempt(label + ": a number", () => invoke(kindOfNumber, 7));
  attempt(label + ": a Number object", () => invoke(kindOfNumber, new Number(7)));
  attempt(label + ": a text", () => invoke(kindOfText, "abc"));
  attempt(label + ": a String object", () => invoke(kindOfText, new String("abc")));
  attempt(label + ": false", () => invoke(kindOfBoolean, false));
  attempt(label + ": a bigint", () => invoke(kindOfBigInt, 10n));
  attempt(label + ": a symbol", () => invoke(kindOfSymbol, Symbol.iterator));
  attempt(label + ": undefined", () => invoke(kindOfNothing, undefined));
  attempt(label + ": null", () => invoke(kindOfNothing, null));
  attempt(label + ": a store on a number", () => invoke(storesOnNumber, 7));
  attempt(label + ": a number against itself", () => invoke(comparesWithItself, 7, 7));
}

attempt("called directly: a number", () => kindOfNumber.call(7));
attempt("called directly: a text", () => kindOfText.call("abc"));
attempt("called directly: false", () => kindOfBoolean.call(false));
attempt("called directly: nothing", () => kindOfNothing());
attempt("called directly: a store on a number", () => storesOnNumber.call(7));

Number.prototype.kindOfReceiver = kindOfNumber;
String.prototype.kindOfReceiver = kindOfText;
Object.defineProperty(Number.prototype, "kindFromGetter", { get: kindOfNumber, configurable: true });
Object.defineProperty(String.prototype, "kindFromGetter", { get: kindOfText, configurable: true });
Object.defineProperty(Number.prototype, "kindToSetter", { set(value) { log.push(typeof this + " " + value); }, configurable: true });
function asksNumber(n) {
  return n.kindOfReceiver();
}
function asksText(s) {
  return s.kindOfReceiver();
}
function readsGetter(value) {
  return value.kindFromGetter;
}
function storesThroughSetter(n) {
  n.kindToSetter = 5;
  return typeof n;
}
attempt("as a method of a number", () => asksNumber(7));
attempt("as a method of a Number object", () => asksNumber(new Number(7)));
attempt("as a method of a text", () => asksText("abc"));
attempt("as a getter of a number", () => readsGetter(7));
attempt("as a getter of a text", () => readsGetter("abc"));
attempt("as a setter of a number", () => storesThroughSetter(7));
delete Number.prototype.kindOfReceiver;
delete String.prototype.kindOfReceiver;
delete Number.prototype.kindFromGetter;
delete String.prototype.kindFromGetter;
delete Number.prototype.kindToSetter;
attempt("after the method is gone", () => asksNumber(7));
attempt("after the getter is gone", () => readsGetter(7));
