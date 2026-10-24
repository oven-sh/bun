function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Box {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  area() {
    return this.width * this.height;
  }
}

function read(box) {
  return box.width;
}

function store(box) {
  box.width = 5;
  return box.width;
}

function add(box) {
  box.depth = 6;
  return box.depth;
}

function remove(box) {
  return delete box.height;
}

function area(box) {
  return box.area();
}

function look(box) {
  return [read, area, store, add, remove]
    .map(use => {
      try {
        return show(use(box));
      } catch (error) {
        return error.constructor.name;
      }
    })
    .join(" ") + " | keys " + Object.keys(box).join();
}

const other = { area: () => "another area" };

const natives = [
  ["Object", "freeze", box => [box]],
  ["Object", "seal", box => [box]],
  ["Object", "preventExtensions", box => [box]],
  ["Reflect", "preventExtensions", box => [box]],
  ["Reflect", "deleteProperty", box => [box, "width"]],
  ["Reflect", "set", box => [box, "width", "set"]],
  ["Reflect", "defineProperty", box => [box, "width", { get: () => "got", configurable: true }]],
  ["Object", "defineProperty", box => [box, "width", { value: "fixed", writable: false }]],
  ["Object", "setPrototypeOf", box => [box, other]],
  ["Object", "assign", box => [box, { width: "assigned", extra: 1 }]],
];

const { freeze: pulledOutFreeze } = Object;
const renamed = Object;
const call = Function.prototype.call;

const routes = [
  ["a plain call", (holder, name, inputs) => (holder === "Object" ? Object : Reflect)[name](...inputs)],
  ["a name joined at run time", (holder, name, inputs) => globalThis[holder][name.slice(0, 2) + name.slice(2)](...inputs)],
  ["a holder under another name", (holder, name, inputs) => (holder === "Object" ? renamed : Reflect)[name](...inputs)],
  ["call", (holder, name, inputs) => globalThis[holder][name].call(null, ...inputs)],
  ["apply", (holder, name, inputs) => globalThis[holder][name].apply(null, inputs)],
  ["bind", (holder, name, inputs) => globalThis[holder][name].bind(null, ...inputs)()],
  ["Reflect.apply", (holder, name, inputs) => Reflect.apply(globalThis[holder][name], null, inputs)],
  ["call.call", (holder, name, inputs) => call.call(globalThis[holder][name], null, ...inputs)],
  ["a callable proxy", (holder, name, inputs) => new Proxy(globalThis[holder][name], {})(...inputs)],
  ["its descriptor's value", (holder, name, inputs) => Object.getOwnPropertyDescriptor(globalThis[holder], name).value(...inputs)],
  ["a parameter", (holder, name, inputs) => ((callee, list) => callee(...list))(globalThis[holder][name], inputs)],
  ["a promise reaction", (holder, name, inputs) => Promise.resolve(inputs).then(list => globalThis[holder][name](...list))],
];

for (let i = 0; i < 2000; i++) look(new Box(3, 4));
console.log("honest", look(new Box(3, 4)));

for (const [holder, name, inputsFor] of natives) {
  for (const [route, reach] of routes) {
    const box = new Box(3, 4);
    let line = holder + "." + name + " through " + route + " -> ";
    try {
      await reach(holder, name, inputsFor(box));
      line += look(box);
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line);
  }
}

const handedOver = [
  ["forEach(Object.freeze)", box => [box].forEach(Object.freeze)],
  ["map(Object.seal)", box => [box].map(Object.seal)],
  ["Array.from with Object.freeze", box => Array.from([box], Object.freeze)],
  ["find(Object.isFrozen) after some(Object.freeze)", box => [[box].some(Object.freeze), [box].find(Object.isFrozen)]],
  ["then(Object.freeze)", box => Promise.resolve(box).then(Object.freeze)],
  ["a freeze pulled out of Object", box => pulledOutFreeze(box)],
  ["a Set's forEach", box => new Set([box]).forEach(Object.freeze)],
  ["a Map's forEach", box => new Map([["key", box]]).forEach(Object.freeze)],
  ["a reviver's holder", box => JSON.parse("[1]", function (key, value) { if (key === "0") Object.freeze(box); return value; })],
  ["Object.entries, then freeze each value", box => Object.entries({ box }).forEach(([, value]) => Object.freeze(value))],
  ["freeze of an object that holds it", box => Object.freeze({ box })],
  ["freeze of an array that holds it", box => Object.freeze([box])],
  ["freeze of its prototype's copy", box => Object.freeze(Object.create(box))],
];

for (const [label, reach] of handedOver) {
  const box = new Box(3, 4);
  let line = label + " -> ";
  try {
    await reach(box);
    line += look(box);
  } catch (error) {
    line += "threw " + error.constructor.name;
  }
  console.log(line);
}
console.log("honest again", look(new Box(3, 4)));
