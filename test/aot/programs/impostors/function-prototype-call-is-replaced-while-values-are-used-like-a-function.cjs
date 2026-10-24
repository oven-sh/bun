function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function plus(a, b) {
  return a + b;
}

function throughCall(f) {
  return f.call(null, 1, 2);
}

function throughApply(f) {
  return f.apply(null, [1, 2]);
}

function throughBind(f) {
  return f.bind(null, 1)(2);
}

function consistent(name, mine, use, honestAnswer) {
  const original = Function.prototype[name];
  let outcome;
  try {
    Function.prototype[name] = mine;
    outcome = "the store returned";
  } catch (error) {
    outcome = "the store threw";
  }
  const isReplaced = Function.prototype[name] === mine;
  const answer = use(plus);
  const expected = isReplaced ? "mine" : honestAnswer;
  console.log(answer === expected ? "ok" : "WRONG", name + ": what a use answers agrees with what Function.prototype holds");
  try {
    Function.prototype[name] = original;
  } catch (error) {}
  console.log(Function.prototype[name] === original ? "ok" : "WRONG", name + " is the original again");
  console.log(use(plus) === honestAnswer ? "ok" : "WRONG", name + " answers as at first");
}

for (let i = 0; i < 2000; i++) {
  throughCall(plus);
  throughApply(plus);
  throughBind(plus);
}
console.log("at first", throughCall(plus), throughApply(plus), throughBind(plus));
consistent("call", function () { return "mine"; }, throughCall, 3);
consistent("apply", function () { return "mine"; }, throughApply, 3);
consistent("bind", function () { return function () { return "mine"; }; }, throughBind, 3);

function consistentByDefinition(name, mine, use, honestAnswer) {
  const original = Object.getOwnPropertyDescriptor(Function.prototype, name);
  let isDefined = false;
  try {
    isDefined = Reflect.defineProperty(Function.prototype, name, { value: mine, writable: true, configurable: true });
  } catch (error) {}
  const isReplaced = Function.prototype[name] === mine;
  console.log(isDefined === isReplaced ? "ok" : "WRONG", name + ": Reflect.defineProperty says what happened");
  console.log(use(plus) === (isReplaced ? "mine" : honestAnswer) ? "ok" : "WRONG", name + ": a use agrees with it");
  try {
    Reflect.defineProperty(Function.prototype, name, original);
  } catch (error) {}
  console.log(use(plus) === honestAnswer ? "ok" : "WRONG", name + " answers as at first");
}

consistentByDefinition("call", function () { return "mine"; }, throughCall, 3);
consistentByDefinition("apply", function () { return "mine"; }, throughApply, 3);
consistentByDefinition("bind", function () { return function () { return "mine"; }; }, throughBind, 3);

const own = function (a, b) { return a * b; };
own.call = function () { return "own call"; };
attempt("a function with its own call", () => [throughCall(own), throughApply(own), throughBind(own)]);
delete own.call;
attempt("after it was deleted", () => [throughCall(own), throughApply(own), throughBind(own)]);
const parent = function () {};
parent.apply = function () { return "the parent's apply"; };
Object.setPrototypeOf(own, parent);
attempt("a function that inherits from a function with its own apply", () => [throughCall(own), throughApply(own), throughBind(own)]);
console.log("at the end", throughCall(plus), throughApply(plus), throughBind(plus));
