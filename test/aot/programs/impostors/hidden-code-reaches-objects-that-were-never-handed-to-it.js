function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Leaf {
  constructor(value) {
    this.value = value;
    this.tag = "leaf";
  }
  double() {
    return this.value * 2;
  }
  set(value) {
    this.value = value;
    return this.value;
  }
}

class Branch {
  constructor(leaf) {
    this.leaf = leaf;
  }
  getLeaf() {
    return this.leaf;
  }
}

function valueOf(leaf) {
  return leaf.value;
}

function plusOne(leaf) {
  return leaf.value + 1;
}

function doubled(leaf) {
  return leaf.double();
}

function store(leaf) {
  return leaf.set(5);
}

function giveTo(callback, leaf) {
  return callback(leaf);
}

function handOver(leaf, callback) {
  return callback(leaf);
}

function throwIt(leaf) {
  throw leaf;
}

function* yieldIt(leaf) {
  yield leaf;
}

function passArguments(hidden, mutate) {
  return function () {
    return hidden(arguments, mutate);
  };
}

const mark = Symbol("mark");

const routes = [
  ["handed over itself", "mutate(input);", leaf => leaf],
  ["a field of what was handed over", "mutate(input.leaf);", leaf => new Branch(leaf)],
  ["two fields down", "mutate(input.leaf.leaf);", leaf => new Branch(new Branch(leaf))],
  ["the result of a method", "mutate(input.getLeaf());", leaf => new Branch(leaf)],
  ["the result of a closure", "mutate(input());", leaf => () => leaf],
  ["an element", "mutate(input[1]);", leaf => [0, leaf]],
  ["an element of an element", "mutate(input[0][0]);", leaf => [[leaf]]],
  ["a value of a Map", "mutate(input.get('key'));", leaf => new Map([["key", leaf]])],
  ["a member of a Set", "for (const each of input) mutate(each);", leaf => new Set([leaf])],
  ["a getter", "mutate(input.found);", leaf => ({ get found() { return leaf; } })],
  ["a member under a symbol", "mutate(input[Object.getOwnPropertySymbols(input)[0]]);", leaf => ({ [mark]: leaf })],
  ["a member that is not enumerable", "mutate(input.quiet);", leaf => Object.defineProperty({}, "quiet", { value: leaf })],
  ["the prototype of what was handed over", "mutate(Object.getPrototypeOf(input));", leaf => Object.create(leaf)],
  ["a generator", "for (const each of input) mutate(each);", leaf => yieldIt(leaf)],
  ["a thrown value", "try { input(); } catch (caught) { mutate(caught); }", leaf => () => throwIt(leaf)],
  ["a callback that visible code calls", "input(mutate);", leaf => callback => giveTo(callback, leaf)],
  ["a bound argument", "input(mutate);", leaf => handOver.bind(null, leaf)],
  ["the global object", "mutate(globalThis.sharedLeaf);", leaf => { globalThis.sharedLeaf = leaf; }],
  ["a proxy's target", "mutate(input);", leaf => new Proxy(leaf, {})],
  ["a WeakRef", "mutate(input.deref());", leaf => new WeakRef(leaf)],
];

const mutations = [
  ["stores a string", "leaf.value = 'hidden';"],
  ["stores 1.5", "leaf.value = 1.5;"],
  ["deletes value", "delete leaf.value;"],
  ["freezes it", "Object.freeze(leaf);"],
  ["turns value into a getter", "Object.defineProperty(leaf, 'value', { get() { return 'getter'; }, configurable: true });"],
  ["gives it its own double", "leaf.double = function () { return 'own double'; };"],
  ["moves it", "Object.setPrototypeOf(leaf, { double() { return 'moved'; }, set() { return 'moved'; } });"],
];

function look(leaf) {
  return [valueOf, plusOne, doubled, store].map(use => {
    try {
      return show(use(leaf));
    } catch (error) {
      return error.constructor.name;
    }
  }).join(" ");
}

for (let i = 0; i < 2000; i++) look(new Leaf(i % 7));
console.log("honest", look(new Leaf(1)));

for (const [route, routeText, wrap] of routes) {
  const hidden = new Function("input", "mutate", routeText);
  for (const [mutation, mutationText] of mutations) {
    const leaf = new Leaf(1);
    const mutate = new Function("leaf", mutationText);
    let line = route + " | " + mutation + " -> ";
    try {
      hidden(wrap(leaf), mutate);
      line += look(leaf);
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line);
  }
}
delete globalThis.sharedLeaf;

for (const [mutation, mutationText] of mutations) {
  const leaf = new Leaf(1);
  passArguments(new Function("input", "mutate", "mutate(input[0]);"), new Function("leaf", mutationText))(leaf);
  console.log("the arguments object | " + mutation + " -> " + look(leaf));
  const other = new Leaf(1);
  new Function("mutate", "mutate(this);").call(other, new Function("leaf", mutationText));
  console.log("this | " + mutation + " -> " + look(other));
}

const untouched = new Leaf(1);
new Function("input", "Object.getPrototypeOf(input).double = function () { return 'every leaf was changed'; };")(new Leaf(2));
console.log("hidden code patched the class through one instance, another instance -> " + look(untouched));
new Function("input", "input.constructor.prototype.set = function () { return 'set was changed too'; };")(new Leaf(2));
console.log("and through the constructor member -> " + look(untouched));
const made = new Function("input", "return new input.constructor('made by hidden code');")(new Leaf(2));
console.log("an instance that hidden code constructed -> " + look(made) + " " + (made instanceof Leaf));
