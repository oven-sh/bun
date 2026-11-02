// `o[s]` with `s = Symbol.iterator` finds what `o[Symbol.iterator]` finds, whoever has changed the member in between.
const iterator = Symbol.iterator;
const toPrimitive = Symbol.toPrimitive;
const hasInstance = Symbol.hasInstance;
const toStringTag = Symbol.toStringTag;
const guarded = typeof Symbol === "function" && Symbol.iterator;

function read(o, key) {
  try {
    return o[key];
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : "other";
  }
}
const nameOf = f => (typeof f === "function" ? f.name : String(f));

function readsOfBuiltins() {
  const list = [1, 2, 3];
  return [
    nameOf(list[iterator]),
    nameOf(list[guarded]),
    nameOf("ab"[iterator]),
    nameOf(new Map()[iterator]),
    nameOf(new Set()[iterator]),
    nameOf(new Uint8Array(2)[iterator]),
    nameOf(list[iterator]()[iterator]),
    nameOf((5)[iterator]),
    nameOf({}[iterator]),
    nameOf(new Date(0)[toPrimitive]),
    nameOf(Function.prototype[hasInstance]),
    new Map()[toStringTag],
    read(undefined, iterator),
    read(null, guarded),
  ].join();
}

function ownMembers() {
  const o = { [iterator]: 1, [toStringTag]: "Mine" };
  o[toPrimitive] = () => 42;
  const out = [o[iterator], o[Symbol.iterator], String(o), +o, iterator in o, hasInstance in o];
  delete o[iterator];
  out.push(o[iterator], iterator in o, Object.getOwnPropertySymbols(o).length);
  return out.join();
}

function listWithItsOwnIterator() {
  const list = [1, 2, 3];
  const before = list[iterator] === Array.prototype.values;
  list[iterator] = function* () {
    yield "own";
  };
  return [before, [...list].join(), nameOf(list[guarded]), list[iterator] === Array.prototype.values].join();
}

function classes() {
  class Even {
    static [hasInstance](n) {
      return n % 2 === 0;
    }
    get [toStringTag]() {
      return "Even";
    }
    *[iterator]() {
      yield 2;
      yield 4;
    }
  }
  const e = new Even();
  return [
    2 instanceof Even,
    3 instanceof Even,
    String(e),
    [...e].join(),
    nameOf(e[iterator]),
    nameOf(Even[hasInstance]),
  ].join();
}

function behindProxy() {
  const seen = [];
  const p = new Proxy([7, 8], {
    get(target, key, receiver) {
      seen.push(typeof key === "symbol" ? key.description : key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      seen.push("has " + String(key.description));
      return key in target;
    },
  });
  const f = p[iterator];
  return [nameOf(f), iterator in p, seen.join("|")].join();
}

function asValues(which) {
  const s = which === 0 ? iterator : which === 1 ? toPrimitive : Symbol("mine");
  const table = new Map([
    [iterator, "i"],
    [toPrimitive, "p"],
  ]);
  let named;
  switch (s) {
    case Symbol.iterator:
      named = "iterator";
      break;
    case Symbol.toPrimitive:
      named = "toPrimitive";
      break;
    default:
      named = "other";
  }
  return [
    typeof s,
    s === Symbol.iterator,
    s == iterator,
    s.description,
    s.toString(),
    table.get(s),
    named,
    Object(s) == s,
    nameOf([][s]),
  ].join();
}

function storesThroughParameter(o, key, value) {
  o[key] = value;
  return o[key];
}

for (let round = 0; round < 3; round++) {
  console.log(readsOfBuiltins());
  console.log(ownMembers());
  console.log(listWithItsOwnIterator());
  console.log(classes());
  console.log(behindProxy());
  console.log(asValues(0), asValues(1), asValues(2));
  console.log(
    storesThroughParameter({}, iterator, round),
    storesThroughParameter([], toStringTag, "t" + round),
    storesThroughParameter({}, "plain", round),
  );
}
