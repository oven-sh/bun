// Fields that objects gain late and some of them never: read, asked for and listed by name where nobody knows the class, before and after something stands above.
class Plain {
  constructor(own) {
    this.own = own;
  }
}
class Heir extends Plain {}
function Old(own) {
  this.own = own;
}
const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho", "sigma", "tau", "upsilon"];
const symbol = Symbol("late");
function fill(object, turn) {
  if (turn & 1) object.alpha = turn;
  if (turn & 2) object.beta = undefined;
  if (turn & 4) object.gamma = "g" + turn;
  if (turn & 8) object.delta = { turn };
  if (turn & 16) object.epsilon = turn / 3;
  if (turn & 32) object[symbol] = turn;
  if (turn & 64) object.zeta = null;
  if (turn & 128) object.eta = undefined;
  if (turn & 256) object.theta = () => turn;
  if (turn & 512) object.iota = -0;
  if (turn & 1024) object.kappa = 2n;
}
function show(value) {
  return value === undefined ? "u" : value === null ? "n" : typeof value === "object" ? "o" : typeof value === "function" ? "f" : typeof value === "bigint" ? "b" : Object.is(value, -0) ? "-0" : typeof value === "symbol" ? "s" : String(value).slice(0, 4);
}
function read(o) {
  return [o.alpha, o.beta, o.gamma, o.delta, o.epsilon, o[symbol], o.zeta, o.eta, o.theta, o.iota, o.kappa].map(show).join();
}
function ask(o) {
  return [
    "alpha" in o, "beta" in o, "gamma" in o, "delta" in o, "epsilon" in o, symbol in o, "zeta" in o, "eta" in o, "theta" in o, "iota" in o, "kappa" in o,
    Object.hasOwn(o, "alpha"), Object.hasOwn(o, "beta"), o.hasOwnProperty("eta"), o.hasOwnProperty(symbol), Object.prototype.hasOwnProperty.call(o, "kappa"),
  ].map(Number).join("");
}
function tellTruth(o) {
  return (o.alpha ? 1 : 0) + (o.beta ? 2 : 0) + (o.gamma ? 4 : 0) + (o.delta ? 8 : 0) + (o.epsilon ? 16 : 0) + (o[symbol] ? 32 : 0) + (o.zeta ?? "no") + (o.eta ?? "no") + (o.theta?.() ?? "no");
}
function list(o) {
  return Object.keys(o).join() + "/" + Object.getOwnPropertySymbols(o).length + "/" + JSON.stringify(o, (key, value) => (typeof value === "bigint" ? "big" : value));
}
let hash = 0;
function take(text) {
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
}
function round(makers, turns, step) {
  for (let turn = 0; turn < turns; turn += step) {
    for (const make of makers) {
      const object = make(turn);
      take(read(object) + ask(object));
      fill(object, turn);
      take(read(object) + ask(object) + tellTruth(object) + list(object));
    }
  }
  console.log(hash);
}
const makers = [turn => new Plain(turn), turn => new Heir(turn), turn => new Old(turn), () => ({ own: 1 }), () => Object.create(null, { hasOwnProperty: { value: Object.prototype.hasOwnProperty } })];
round(makers, 2048, 5);
const object = new Plain(0);
const other = new Old(0);
fill(other, 2047);
console.log(read(object), ask(object), read(other), ask(other), list(other));
Plain.prototype.alpha = "above";
console.log(read(object), ask(object), read(new Heir(1)));
round(makers, 512, 3);
Object.defineProperty(Old.prototype, "beta", { get() { return "got"; }, configurable: true });
console.log(read(new Old(1)), ask(new Old(1)), read(other), ask(other));
round(makers, 512, 3);
Heir.prototype.eta = "below";
console.log(read(object), ask(object), read(other), ask(other), read(new Heir(2)));
round(makers, 512, 3);
delete Heir.prototype.eta;
delete Plain.prototype.alpha;
delete Old.prototype.beta;
console.log(read(object), ask(object), read(other), ask(other));
round(makers, 512, 3);
for (const name of names) {
  delete other[name];
  console.log(name, read(other), ask(other));
}
Object.setPrototypeOf(object, { alpha: "put above", get kappa() { return "getter above"; } });
console.log(read(object), ask(object));
object.alpha = undefined;
console.log(read(object), ask(object), list(object));
delete object.alpha;
console.log(read(object), ask(object), list(object));
Object.freeze(object);
object.beta = 1;
console.log(read(object), ask(object), list(object));
round(makers, 512, 3);
