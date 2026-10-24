import { format, inspect } from "node:util";

const { keys: pulledOut } = Object;

function callWith(callee, input) {
  return callee(input);
}

function walk(thing) {
  const names = [];
  for (const name in thing) names.push(name);
  return names;
}

function walkEach(things) {
  const names = [];
  things.forEach(thing => {
    for (const name in thing) names.push(name);
  });
  return names;
}

function copy(thing) {
  return { ...thing };
}

function withoutBeta(thing) {
  const { beta, ...rest } = thing;
  return rest;
}

class ByPlainCall {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByMap {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByCall {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByApply {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByReflectApply {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByParameter {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByJoinedName {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByPattern {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByOwnKeys {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByOwnNames {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByEntries {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByValues {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByDescriptors {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByForIn {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByForInInACallback {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByForInOverAChild {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByJson {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByJsonParameter {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByJsonOfAList {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByJsonOfAHolder {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByJsonOfAMapValue {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByAssign {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByAssignCall {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class BySpread {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class BySpreadInAFunction {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByRest {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByClone {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByInspect {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByBunInspect {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

class ByFormat {
  constructor(backwards) {
    if (backwards) { this.gamma = 3; this.beta = 2; this.alpha = 1; } else { this.alpha = 1; this.beta = 2; this.gamma = 3; }
  }
  sum() { return this.alpha + this.beta + this.gamma; }
}

const rows = [
  ["Object.keys(thing)", backwards => new ByPlainCall(backwards), thing => Object.keys(thing)],
  ["[thing].map(Object.keys)", backwards => new ByMap(backwards), thing => [thing].map(Object.keys)[0]],
  ["Object.keys.call(null, thing)", backwards => new ByCall(backwards), thing => Object.keys.call(null, thing)],
  ["Object.keys.apply(null, [thing])", backwards => new ByApply(backwards), thing => Object.keys.apply(null, [thing])],
  ["Reflect.apply(Object.keys, null, [thing])", backwards => new ByReflectApply(backwards), thing => Reflect.apply(Object.keys, null, [thing])],
  ["a function that calls its parameter with Object.keys", backwards => new ByParameter(backwards), thing => callWith(Object.keys, thing)],
  ["Object[joined name](thing)", backwards => new ByJoinedName(backwards), thing => Object[["ke", "ys"].join("")](thing)],
  ["const { keys } = Object; keys(thing)", backwards => new ByPattern(backwards), thing => pulledOut(thing)],
  ["a function that calls its parameter with Reflect.ownKeys", backwards => new ByOwnKeys(backwards), thing => callWith(Reflect.ownKeys, thing)],
  ["[thing].map(Object.getOwnPropertyNames)", backwards => new ByOwnNames(backwards), thing => [thing].map(Object.getOwnPropertyNames)[0]],
  ["a function that calls its parameter with Object.entries", backwards => new ByEntries(backwards), thing => callWith(Object.entries, thing).map(entry => entry[0])],
  ["[thing].flatMap(Object.values)", backwards => new ByValues(backwards), thing => [thing].flatMap(Object.values)],
  ["Object.keys(Object.getOwnPropertyDescriptors(thing))", backwards => new ByDescriptors(backwards), thing => Object.keys(Object.getOwnPropertyDescriptors(thing))],
  ["for-in", backwards => new ByForIn(backwards), thing => walk(thing)],
  ["for-in inside a callback of forEach", backwards => new ByForInInACallback(backwards), thing => walkEach([thing])],
  ["for-in over an object that inherits from it", backwards => new ByForInOverAChild(backwards), thing => walk(Object.create(thing))],
  ["JSON.stringify(thing)", backwards => new ByJson(backwards), thing => JSON.stringify(thing)],
  ["a function that calls its parameter with JSON.stringify", backwards => new ByJsonParameter(backwards), thing => callWith(JSON.stringify, thing)],
  ["JSON.stringify([thing])", backwards => new ByJsonOfAList(backwards), thing => JSON.stringify([thing])],
  ["JSON.stringify({ holder: thing })", backwards => new ByJsonOfAHolder(backwards), thing => JSON.stringify({ holder: thing })],
  ["JSON.stringify of the values of a Map", backwards => new ByJsonOfAMapValue(backwards), thing => JSON.stringify([...new Map([[1, thing]]).values()])],
  ["Object.assign({}, thing)", backwards => new ByAssign(backwards), thing => Object.keys(Object.assign({}, thing))],
  ["Object.assign.call(null, {}, thing)", backwards => new ByAssignCall(backwards), thing => Object.keys(Object.assign.call(null, {}, thing))],
  ["{ ...thing }", backwards => new BySpread(backwards), thing => Object.keys({ ...thing })],
  ["a function that spreads its parameter", backwards => new BySpreadInAFunction(backwards), thing => Object.keys(copy(thing))],
  ["const { beta, ...rest } = thing", backwards => new ByRest(backwards), thing => Object.keys(withoutBeta(thing))],
  ["structuredClone(thing)", backwards => new ByClone(backwards), thing => Object.keys(structuredClone(thing))],
  ["inspect(thing)", backwards => new ByInspect(backwards), thing => inspect(thing)],
  ["Bun.inspect(thing)", backwards => new ByBunInspect(backwards), thing => Bun.inspect(thing).replace(/\s+/g, " ")],
  ["format(\"%j\", thing)", backwards => new ByFormat(backwards), thing => format("%j", thing)],
];

let sum = 0;
for (let i = 0; i < 2000; i++) for (const [, make] of rows) sum += make(false).sum() + make(true).sum();
console.log("2000 honest rounds", sum);

for (const [label, make, list] of rows) {
  console.log(label + " | forwards -> " + String(list(make(false))));
  console.log(label + " | backwards -> " + String(list(make(true))));
}
