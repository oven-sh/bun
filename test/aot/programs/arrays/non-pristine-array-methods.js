// push, slice, indexOf, includes, spread and a read of a hole on a plain array, which takes the fast path, and on arrays for which that path gives a wrong answer: an instance of a subclass, an array whose prototype has an element, an array with its own Symbol.iterator, a frozen array.
class Subclass extends Array {}

function createSubclassInstance() {
  const list = new Subclass(3);
  list[0] = "a";
  list[2] = "c";
  return list;
}

function createArrayWithOwnIterator() {
  const list = ["a", , "c"];
  list[Symbol.iterator] = function* () {
    yield "from";
    yield "own iterator";
  };
  return list;
}

const kinds = [
  ["plain", () => ["a", , "c"]],
  ["subclass", createSubclassInstance],
  ["element in prototype", () => Object.setPrototypeOf(["a", , "c"], { __proto__: Array.prototype, 1: "inherited" })],
  ["own iterator", createArrayWithOwnIterator],
  ["frozen", () => Object.freeze(["a", , "c"])],
];

function push(list, value) { return list.push(value); }
function slice(list, start) { return list.slice(start); }
function indexOf(list, value) { return list.indexOf(value); }
function includes(list, value) { return list.includes(value); }
function spread(list) { return [...list]; }
function elementAt(list, index) { return list[index]; }

// An inherited element is in parentheses, a hole is a dash.
function describe(list) {
  const elements = [];
  for (let index = 0; index < list.length; index++) {
    if (Object.hasOwn(list, index)) elements.push(String(list[index]));
    else elements.push(index in list ? `(${list[index]})` : "-");
  }
  return `${list.constructor.name} [${elements.join(", ")}]`;
}

function describePush(list) {
  let outcome;
  try {
    outcome = push(list, "d");
  } catch (error) {
    outcome = `throws ${error.constructor.name}`;
  }
  return `${outcome}, then ${describe(list)}`;
}

// In every round after the first, each call site has already seen every kind of array.
for (let round = 1; round <= 3; round++) {
  for (const [kind, create] of kinds) {
    const report = (operation, outcome) => console.log(`round ${round}, ${kind}, ${operation}: ${outcome}`);
    report("push", describePush(create()));
    report("slice", `${describe(slice(create(), 0))}, ${describe(slice(create(), 1))}`);
    for (const value of ["c", "inherited", undefined]) {
      report(`indexOf ${value}`, indexOf(create(), value));
      report(`includes ${value}`, includes(create(), value));
    }
    report("spread", describe(spread(create())));
    report("hole", elementAt(create(), 1));
  }
}
