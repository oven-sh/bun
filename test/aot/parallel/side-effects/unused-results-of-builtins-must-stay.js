// A built-in whose result nobody uses still runs where an operand runs code of the program or makes it throw: a getter, a trap of a proxy, a conversion, toJSON, an iterator, a callback, a value that the built-in refuses.
const log = [];
const note = text => {
  log.push("  ran " + text);
  return 1;
};

function attempt(name, run) {
  log.push(name);
  try {
    run();
  } catch (error) {
    log.push("  threw " + error.constructor.name);
  }
}

const withGetter = () => ({
  get a() {
    return note("the getter of a");
  },
  b: 2,
});
const trapped = () =>
  new Proxy(
    { a: 1 },
    {
      ownKeys(target) {
        note("ownKeys");
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        note("getOwnPropertyDescriptor of " + String(key));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(target, key) {
        note("get of " + String(key));
        return target[key];
      },
      preventExtensions() {
        note("preventExtensions");
        return false;
      },
    },
  );
const converted = text => ({
  toString() {
    note("toString");
    return text;
  },
  valueOf() {
    note("valueOf");
    return 1;
  },
});
const iterable = (...values) => ({
  [Symbol.iterator]() {
    note("@@iterator");
    return values[Symbol.iterator]();
  },
});

attempt("Object.keys of a proxy", () => {
  Object.keys(trapped());
});
attempt("Object.keys of null", () => {
  Object.keys(null);
});
attempt("Object.keys of undefined", () => {
  Object.keys(undefined);
});
attempt("Object.getOwnPropertyNames of a proxy", () => {
  Object.getOwnPropertyNames(trapped());
});
attempt("Object.entries with a getter", () => {
  Object.entries(withGetter());
});
attempt("Object.entries of a proxy", () => {
  Object.entries(trapped());
});
attempt("Object.entries of null", () => {
  Object.entries(null);
});
attempt("Object.values with a getter", () => {
  Object.values(withGetter());
});
attempt("Object.assign from a getter", () => {
  Object.assign({}, withGetter());
});
attempt("Object.assign onto a setter", () => {
  Object.assign(
    {
      set a(value) {
        note("the setter of a");
      },
    },
    { a: 1 },
  );
});
attempt("Object.assign onto a frozen object", () => {
  Object.assign(Object.freeze({}), { a: 1 });
});
attempt("Object.assign onto a read-only property", () => {
  Object.assign(Object.defineProperty({}, "a", { value: 0 }), { a: 1 });
});
attempt("Object.assign onto null", () => {
  Object.assign(null, { a: 1 });
});
attempt("Object.freeze of a proxy that refuses", () => {
  Object.freeze(trapped());
});
attempt("Object.freeze of a typed array with elements", () => {
  Object.freeze(new Uint8Array(1));
});
attempt("Object.hasOwn with a converted key", () => {
  Object.hasOwn({ a: 1 }, converted("a"));
});
attempt("Object.hasOwn of null", () => {
  Object.hasOwn(null, "a");
});
attempt("hasOwnProperty on undefined", () => {
  Object.prototype.hasOwnProperty.call(undefined, "a");
});
attempt("Object.prototype.toString with a getter for the tag", () => {
  Object.prototype.toString.call({
    get [Symbol.toStringTag]() {
      return note("the getter of @@toStringTag");
    },
  });
});

attempt("map with a callback that stores", () => {
  [1, 2, 3].map(x => note("the callback with " + x));
});
attempt("filter and reduce with callbacks that store", () => {
  [1, 2, 3].filter(x => note("the test of " + x)).reduce((sum, x) => sum + note("the sum with " + x), 0);
});
attempt("reduce of an empty array", () => {
  [].reduce((sum, x) => sum + x);
});
attempt("map with something that is no function", () => {
  [1].map(1);
});
attempt("for-of over an iterable of the program", () => {
  for (const x of iterable(1, 2)) {
    x + 1;
  }
});
attempt("for-of over a number", () => {
  for (const x of 1) {
    x + 1;
  }
});
attempt("a rest pattern over getters", () => {
  const { b, ...rest } = withGetter();
});
attempt("a rest pattern over a proxy", () => {
  const { b, ...rest } = trapped();
});
attempt("a rest pattern over null", () => {
  const { b, ...rest } = null;
});
attempt("an object spread over a getter", () => {
  const u = { ...withGetter() };
});
attempt("an array spread over an iterable of the program", () => {
  const u = [...iterable(1)];
});
attempt("an array spread over null", () => {
  const u = [...null];
});
attempt("an array pattern over an iterable of the program", () => {
  const [p, q] = iterable(1, 2);
});
attempt("an array pattern over undefined", () => {
  const [p] = undefined;
});

attempt("toUpperCase on null", () => {
  String.prototype.toUpperCase.call(null);
});
attempt("toUpperCase on an object", () => {
  String.prototype.toUpperCase.call(converted("a"));
});
attempt("toUpperCase on a symbol", () => {
  String.prototype.toUpperCase.call(Symbol("s"));
});
attempt("slice with a converted position", () => {
  "abc".slice(converted("1"));
});
attempt("repeat with a negative count", () => {
  "a".repeat(-1);
});
attempt("repeat with an infinite count", () => {
  "a".repeat(Infinity);
});
attempt("normalize with an unknown form", () => {
  "a".normalize("X");
});
attempt("startsWith with a regular expression", () => {
  "a".startsWith(/a/);
});
attempt("String.fromCodePoint out of range", () => {
  String.fromCodePoint(-1);
});
attempt("a template with an object", () => {
  const u = `a${converted("b")}`;
});
attempt("a template with a symbol", () => {
  const u = `a${Symbol("s")}`;
});

attempt("JSON.stringify with toJSON", () => {
  JSON.stringify({
    toJSON() {
      return note("toJSON");
    },
  });
});
attempt("JSON.stringify with a getter", () => {
  JSON.stringify(withGetter());
});
attempt("JSON.stringify of a cycle", () => {
  const cycle = {};
  cycle.self = cycle;
  JSON.stringify(cycle);
});
attempt("JSON.stringify of a BigInt", () => {
  JSON.stringify({ a: 1n });
});
attempt("JSON.stringify with a replacer", () => {
  JSON.stringify({ a: 1 }, (key, value) => (note("the replacer with " + JSON.stringify(key)), value));
});
attempt("JSON.parse of half an object", () => {
  JSON.parse("{");
});
attempt("JSON.parse of nothing", () => {
  JSON.parse("");
});
attempt("JSON.parse with a reviver", () => {
  JSON.parse('{"a":1}', (key, value) => (note("the reviver with " + JSON.stringify(key)), value));
});
attempt("JSON.parse of an object", () => {
  JSON.parse(converted("1"));
});

attempt("Array.from with a getter for the length", () => {
  Array.from({
    get length() {
      return note("the getter of length");
    },
  });
});
attempt("Array.from with a length that is too large", () => {
  Array.from({ length: 2 ** 32 });
});
attempt("Array.from an iterable of the program", () => {
  Array.from(iterable(1));
});
attempt("Array.from with a callback that stores", () => {
  Array.from({ length: 2 }, (value, index) => note("the callback with " + index));
});
attempt("new Array with a negative length", () => {
  new Array(-1);
});
attempt("new Array with a fraction", () => {
  new Array(1.5);
});
attempt("Array with a length that is too large", () => {
  Array(2 ** 32);
});
attempt("new Uint8Array with a negative length", () => {
  new Uint8Array(-1);
});
attempt("new Uint8Array with a length above every buffer", () => {
  new Uint8Array(2 ** 40);
});
attempt("new Float64Array with a length above every buffer", () => {
  new Float64Array(2 ** 30);
});
attempt("new Uint8Array of an array-like with a getter", () => {
  new Uint8Array({
    get length() {
      return note("the getter of length");
    },
  });
});
attempt("Uint8Array without new", () => {
  Uint8Array(8);
});
attempt("the abstract typed array class", () => {
  new (Object.getPrototypeOf(Uint8Array))(8);
});

attempt("new Error with a converted message", () => {
  new Error(converted("m"));
});
attempt("new Error with a symbol", () => {
  new Error(Symbol("s"));
});
attempt("new TypeError with a getter for the cause", () => {
  new TypeError("m", {
    get cause() {
      return note("the getter of cause");
    },
  });
});
attempt("new AggregateError of a number", () => {
  new AggregateError(1);
});
attempt("new AggregateError of an iterable of the program", () => {
  new AggregateError(iterable());
});

attempt("new Map of an iterable of the program", () => {
  new Map(iterable([1, 2]));
});
attempt("new Map of entries that are no objects", () => {
  new Map([1]);
});
attempt("new Map of a number", () => {
  new Map(1);
});
attempt("Map without new", () => {
  Map();
});
attempt("new Set of an iterable of the program", () => {
  new Set(iterable(1));
});
attempt("new Set of a number", () => {
  new Set(1);
});
attempt("new WeakMap with a key that is no object", () => {
  new WeakMap([[1, 2]]);
});
attempt("Map.prototype.get on a Set", () => {
  Map.prototype.get.call(new Set(), 1);
});

attempt("Symbol of a symbol", () => {
  Symbol(Symbol("s"));
});
attempt("Symbol of an object", () => {
  Symbol(converted("s"));
});
attempt("new Symbol", () => {
  new Symbol("s");
});
attempt("new Date of an object", () => {
  new Date(converted("0"));
});
attempt("new RegExp of half a group", () => {
  new RegExp("(");
});
attempt("new RegExp of an object", () => {
  new RegExp(converted("a"));
});
attempt("new RegExp with unknown flags", () => {
  new RegExp("a", "X");
});
attempt("Math.max of an object", () => {
  Math.max(converted("1"));
});
attempt("Math.floor of a symbol", () => {
  Math.floor(Symbol("s"));
});
attempt("Math.max of a BigInt", () => {
  Math.max(1n);
});

attempt("a read of a getter", () => {
  const u = withGetter();
  u.a;
});
attempt("a read under a converted key", () => {
  const u = { a: 1 };
  u[converted("a")];
});
attempt("a read from a proxy", () => {
  trapped().a;
});
attempt("a read from null", () => {
  const u = null;
  u.a;
});
attempt("a literal with a converted key", () => {
  const u = { [converted("a")]: 1 };
});
attempt("a class with a field that stores", () => {
  class U {
    n = note("the field");
  }
  const u = new U();
});
attempt("a class with a constructor that stores", () => {
  class U {
    constructor() {
      note("the constructor");
    }
  }
  const u = new U();
});
attempt("a class with a static field that stores", () => {
  class U {
    static s = note("the static field");
  }
});
attempt("a class with a static block", () => {
  class U {
    static {
      note("the static block");
    }
  }
});
attempt("a class that extends null", () => {
  class U extends null {}
  const u = new U();
});
attempt("a class that extends a number", () => {
  class U extends 1 {}
});

attempt("Promise.resolve with a getter for then", () => {
  Promise.resolve({
    get then() {
      note("the getter of then");
      return undefined;
    },
  });
});
attempt("Promise.resolve of a thenable", () => {
  Promise.resolve({
    then(resolve) {
      note("then");
      resolve(1);
    },
  });
});
attempt("Promise.resolve on a number", () => {
  Promise.resolve.call(1, 1);
});

// The same calls where only the run knows the operand.
function unusedResults(value) {
  attempt("  Object.keys", () => {
    Object.keys(value);
  });
  attempt("  Object.entries", () => {
    Object.entries(value);
  });
  attempt("  JSON.stringify", () => {
    JSON.stringify(value);
  });
  attempt("  new Uint8Array", () => {
    new Uint8Array(value);
  });
  attempt("  new Array", () => {
    new Array(value);
  });
  attempt("  new Error", () => {
    new Error(value);
  });
  attempt("  toUpperCase", () => {
    String.prototype.toUpperCase.call(value);
  });
  attempt("  new Map", () => {
    new Map(value);
  });
}
const operands = [{ a: 1 }, withGetter(), trapped(), null, undefined, -1, 8, 2 ** 40, "abc", Symbol("s"), 1n, converted("c"), iterable([1, 2]), [[1, 2]]];
for (let index = 0; index < operands.length; index++) {
  log.push("operand " + index);
  unusedResults(operands[index]);
}

await null;
await null;
await null;
console.log(log.join("\n"));
