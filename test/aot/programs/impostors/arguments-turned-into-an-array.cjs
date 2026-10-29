function show(value) {
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return value.constructor.name + "[" + parts.join(", ") + "]";
  }
  if (typeof value === "function") return "function";
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function attempt(label, run) {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "-> threw", error.constructor.name);
  }
}

function bySpread() {
  return [...arguments];
}
function bySlice() {
  return Array.prototype.slice.call(arguments);
}
function byBoundCall() {
  return Function.prototype.call.bind(Array.prototype.slice, arguments)();
}
function byBoundCallFromOne() {
  return Function.prototype.call.bind(Array.prototype.slice, arguments, 1)();
}
function byFrom() {
  return Array.from(arguments);
}
function byApply() {
  return Array.apply(null, arguments);
}
function byOf() {
  return Array.of.apply(Array, arguments);
}
function byConcat() {
  return Array.prototype.concat.apply([], arguments);
}
function byLoop() {
  const result = [];
  for (let i = 0; i < arguments.length; i++) result.push(arguments[i]);
  return result;
}
function byForOf() {
  const result = [];
  for (const value of arguments) result.push(value);
  return result;
}
function byReflect() {
  return Reflect.apply(Array.prototype.slice, arguments, []);
}
function bySpreadIntoCall() {
  return byRest(...arguments);
}
function byRest(...rest) {
  return rest;
}
function strictBySpread() {
  "use strict";
  return [...arguments];
}
function strictBySlice() {
  "use strict";
  return Array.prototype.slice.call(arguments);
}
function strictByBoundCall() {
  "use strict";
  return Function.prototype.call.bind(Array.prototype.slice, arguments)();
}

const ways = {
  bySpread,
  bySlice,
  byBoundCall,
  byBoundCallFromOne,
  byFrom,
  byApply,
  byOf,
  byConcat,
  byLoop,
  byForOf,
  byReflect,
  bySpreadIntoCall,
  strictBySpread,
  strictBySlice,
  strictByBoundCall,
};

for (let i = 0; i < 2000; i++) for (const name in ways) ways[name](i, i + 1, i + 2);

for (const name in ways) {
  const way = ways[name];
  attempt(name + "()", () => way());
  attempt(name + "(1)", () => way(1));
  attempt(name + "(3)", () => way(3));
  attempt(name + "(1, 2, 3)", () => way(1, 2, 3));
  attempt(name + "(undefined, null)", () => way(undefined, null));
  attempt(name + "([1, 2], [3])", () => way([1, 2], [3]));
  attempt(name + "('ab', 1.5, -0)", () => way("ab", 1.5, -0).map(value => (Object.is(value, -0) ? "-0" : value)));
  attempt(name + " is a fresh array", () => {
    const made = way(1, 2);
    return [Array.isArray(made), Object.getPrototypeOf(made) === Array.prototype, made.push(3), made.length];
  });
}

function changed(change, take) {
  return function (a, b, c) {
    change(arguments);
    return [take(arguments), a, b, c];
  };
}

const takes = {
  spread: list => [...list],
  slice: list => Array.prototype.slice.call(list),
  boundCall: list => Function.prototype.call.bind(Array.prototype.slice, list)(),
  from: list => Array.from(list),
  apply: list => Array.apply(null, list),
};

const changes = {
  "length = 1": list => {
    list.length = 1;
  },
  "length = 5": list => {
    list.length = 5;
  },
  "length = 0": list => {
    list.length = 0;
  },
  "length = '2'": list => {
    list.length = "2";
  },
  "length deleted": list => {
    delete list.length;
  },
  "[0] = 'x'": list => {
    list[0] = "x";
  },
  "[1] deleted": list => {
    delete list[1];
  },
  "[1] deleted and set again": list => {
    delete list[1];
    list[1] = "again";
  },
  "[5] = 'far'": list => {
    list[5] = "far";
  },
  "[1] is a getter": list => {
    Object.defineProperty(list, 1, { get: () => "got", configurable: true });
  },
  "[0] is read-only": list => {
    Object.defineProperty(list, 0, { value: "fixed", writable: false });
  },
  "frozen": list => {
    Object.freeze(list);
  },
  "its own iterator": list => {
    list[Symbol.iterator] = function* () {
      yield "mine";
    };
  },
  "no iterator": list => {
    list[Symbol.iterator] = undefined;
  },
  "prototype is an array": list => {
    Object.setPrototypeOf(list, ["p0", "p1", "p2", "p3", "p4"]);
  },
  "prototype is null": list => {
    Object.setPrototypeOf(list, null);
  },
  "a slice of its own": list => {
    list.slice = () => "own slice";
  },
};

for (const change in changes)
  for (const take in takes) attempt(take + " after " + change, () => changed(changes[change], takes[take])(1, 2, 3));

function parameterStoredFirst(a, b) {
  a = "stored";
  return [[...arguments], Array.prototype.slice.call(arguments), Function.prototype.call.bind(Array.prototype.slice, arguments)()];
}
attempt("a parameter stored to is seen through sloppy arguments", () => parameterStoredFirst(1, 2));
attempt("but not where no argument was passed", () => parameterStoredFirst());

function strictParameterStoredFirst(a, b) {
  "use strict";
  a = "stored";
  return [[...arguments], Array.prototype.slice.call(arguments)];
}
attempt("and not in strict code", () => strictParameterStoredFirst(1, 2));

function withDefault(a, b = 2) {
  a = "stored";
  return [[...arguments], Array.prototype.slice.call(arguments)];
}
attempt("nor beside a default parameter", () => withDefault(1));

function argumentStoredFirst(a, b) {
  arguments[0] = "through arguments";
  return [a, [...arguments]];
}
attempt("a store through sloppy arguments reaches the parameter", () => argumentStoredFirst(1, 2));

function fromAnArrow() {
  return (() => [[...arguments], Array.prototype.slice.call(arguments)])("ignored");
}
attempt("an arrow sees the arguments of the function around it", () => fromAnArrow(1, 2));

function shadowedByAParameter(arguments) {
  return [...arguments];
}
attempt("a parameter named arguments", () => shadowedByAParameter([7, 8]));
attempt("a parameter named arguments that is a text", () => shadowedByAParameter("ab"));
attempt("a parameter named arguments that is a number", () => shadowedByAParameter(5));

function shadowedByAVariable() {
  var arguments = { 0: "a", 1: "b", length: 2 };
  return [Array.prototype.slice.call(arguments), Function.prototype.call.bind(Array.prototype.slice, arguments)()];
}
attempt("a variable named arguments", () => shadowedByAVariable(1, 2, 3));

function leaked() {
  return arguments;
}
attempt("arguments that outlive their call", () => {
  const kept = leaked(1, 2, 3);
  leaked(4, 5, 6);
  return [[...kept], Array.prototype.slice.call(kept), Array.isArray(kept), Object.prototype.toString.call(kept)];
});

function handedOn() {
  return bySlice.apply(null, arguments).concat(bySpread.apply(null, arguments));
}
attempt("arguments handed on by apply", () => handedOn(1, 2));

function inAGenerator() {
  return (function* () {
    yield [...arguments];
    yield Array.prototype.slice.call(arguments);
  })(1, 2);
}
attempt("in a generator", () => [...inAGenerator()]);

const realIterator = Array.prototype[Symbol.iterator];
const realSlice = Array.prototype.slice;
attempt("Array.prototype[Symbol.iterator] is replaced", () => {
  Array.prototype[Symbol.iterator] = function* () {
    yield "replaced";
  };
  try {
    return [bySpread(1, 2), realSlice.call(bySlice(1, 2)), byForOf(1, 2).length];
  } finally {
    Array.prototype[Symbol.iterator] = realIterator;
  }
});
attempt("and put back", () => [bySpread(1, 2), byForOf(1, 2)]);
attempt("Array.prototype.slice is replaced", () => {
  Array.prototype.slice = function () {
    return "replaced";
  };
  try {
    return [bySlice(1, 2), byBoundCall(1, 2), byReflect(1, 2), bySpread(1, 2)];
  } finally {
    Array.prototype.slice = realSlice;
  }
});
attempt("and put back", () => [bySlice(1, 2), byBoundCall(1, 2)]);

const realCall = Function.prototype.call;
attempt("Function.prototype.call is replaced", () => {
  Function.prototype.call = function () {
    return "replaced";
  };
  try {
    return [bySlice(1, 2), byBoundCall(1, 2)];
  } finally {
    Function.prototype.call = realCall;
  }
});
attempt("and put back", () => [bySlice(1, 2), byBoundCall(1, 2)]);

attempt("many arguments", () => {
  const many = [];
  for (let i = 0; i < 5000; i++) many.push(i);
  return [bySpread.apply(null, many).length, bySlice.apply(null, many)[4999], byBoundCall.apply(null, many).length];
});
