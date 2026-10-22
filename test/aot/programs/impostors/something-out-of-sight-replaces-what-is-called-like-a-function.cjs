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

function minus(a, b) {
  return a - b;
}

const name = ["r", "u", "n"].join("");
const zero = name.length - 3;

const byHiddenStore = { run: plus };
const byComputedName = { run: plus };
const byReflectSet = { run: plus };
const byDefinition = { run: plus };
const byGetter = { run: plus };
const byAssign = { run: plus };
const byPrototype = Object.create({ run: plus });
const listByHiddenStore = [plus, minus];
const listByComputedIndex = [plus, minus];
const listByFill = [plus, minus];
const listByUnshift = [plus, minus];
const listBySplice = [plus, minus];
const listByCopyWithin = [plus, minus, null];
const mapBySet = new Map([["run", plus]]);

class Tool {
  constructor() {
    this.own = plus;
  }

  run(a, b) {
    return a + b;
  }

  static make(a, b) {
    return a + b;
  }
}

const toolByField = new Tool();
const toolByShadow = new Tool();
let variableBySetter = plus;

function setVariable(value) {
  variableBySetter = value;
}

function throughArguments(f) {
  arguments[zero] = arguments[1];
  return f(3, 1);
}

const ways = [
  ["hidden code stores to the field", v => new Function("o", "v", "o.run = v")(byHiddenStore, v), () => byHiddenStore.run(3, 1)],
  ["a store under a computed name", v => { byComputedName[name] = v; }, () => byComputedName.run(3, 1)],
  ["Reflect.set", v => Reflect.set(byReflectSet, name, v), () => byReflectSet.run(3, 1)],
  ["Object.defineProperty with a value", v => Object.defineProperty(byDefinition, name, { value: v }), () => byDefinition.run(3, 1)],
  ["Object.defineProperty with a getter", v => Object.defineProperty(byGetter, name, { get: () => v, configurable: true }), () => byGetter.run(3, 1)],
  ["Object.assign", v => Object.assign(byAssign, { [name]: v }), () => byAssign.run(3, 1)],
  ["another prototype", v => Object.setPrototypeOf(byPrototype, { [name]: v }), () => byPrototype.run(3, 1)],
  ["hidden code stores to the element", v => new Function("t", "v", "t[0] = v")(listByHiddenStore, v), () => listByHiddenStore[0](3, 1)],
  ["a store at a computed index", v => { listByComputedIndex[zero] = v; }, () => listByComputedIndex[0](3, 1)],
  ["fill", v => listByFill.fill(v), () => listByFill[0](3, 1)],
  ["unshift", v => listByUnshift.unshift(v), () => listByUnshift[0](3, 1)],
  ["splice", v => listBySplice.splice(0, 1, v), () => listBySplice[0](3, 1)],
  ["copyWithin", v => { listByCopyWithin[2] = v; listByCopyWithin.copyWithin(0, 2); }, () => listByCopyWithin[0](3, 1)],
  ["set of a map", v => mapBySet.set(name, v), () => mapBySet.get("run")(3, 1)],
  ["hidden code stores to a field of an instance", v => new Function("o", "v", "o.own = v")(toolByField, v), () => toolByField.own(3, 1)],
  ["hidden code gives an instance a member that hides the method", v => new Function("o", "v", "o.run = v")(toolByShadow, v), () => toolByShadow.run(3, 1)],
  ["hidden code replaces the method on the prototype", v => new Function("C", "v", "C.prototype.run = v")(Tool, v), () => new Tool().run(3, 1)],
  ["hidden code replaces the static method", v => new Function("C", "v", "C.make = v")(Tool, v), () => Tool.make(3, 1)],
  ["hidden code gets the function that stores to the variable", v => new Function("set", "v", "set(v)")(setVariable, v), () => variableBySetter(3, 1)],
  ["a store to arguments", () => {}, v => throughArguments(plus, v), true],
];

const replacements = [
  ["the other function", () => minus],
  ["a function nobody saw", () => new Function("a", "b", "return 'hidden ' + a + b")],
  ["a bound function", () => plus.bind(null, 100)],
  ["a callable proxy", () => new Proxy(plus, { apply: (target, self, list) => "trapped " + list.join() })],
  ["a class", () => class {}],
  ["an async function", () => async (a, b) => a + b],
  ["an object with call", () => ({ call: plus })],
  ["a string", () => "plus"],
  ["undefined", () => undefined],
  ["the first function again", () => plus],
];

console.log("strict:", (function () { return this === undefined; })());
for (const [label, , call, takesValue] of ways) {
  for (let i = 0; i < 300; i++) takesValue ? call(plus) : call();
  attempt("at first, " + label, () => (takesValue ? call(plus) : call()));
}
for (const [what, make] of replacements) {
  for (const [label, replace, call, takesValue] of ways) {
    attempt(label + ": " + what, () => {
      const value = make();
      replace(value);
      return takesValue ? call(value) : call();
    });
  }
}
