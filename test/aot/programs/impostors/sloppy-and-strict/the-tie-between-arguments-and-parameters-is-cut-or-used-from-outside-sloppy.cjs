console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function change(operands) {
  operands[0] = "changed elsewhere";
}
var uses = {
  removed: function (a) {
    delete arguments[0];
    arguments[0] = "stored again";
    return [a, arguments[0]];
  },
  removedThenAssigned: function (a) {
    delete arguments[0];
    a = "assigned";
    return [a, arguments[0], 0 in arguments];
  },
  madeReadOnly: function (a) {
    Object.defineProperty(arguments, "0", { writable: false });
    a = "assigned";
    return [a, arguments[0]];
  },
  redefined: function (a) {
    Object.defineProperty(arguments, "0", { value: "defined" });
    return [a, arguments[0]];
  },
  redefinedThenAssigned: function (a) {
    Object.defineProperty(arguments, "0", { value: "defined" });
    a = "assigned";
    return [a, arguments[0]];
  },
  madeAnAccessor: function (a) {
    Object.defineProperty(arguments, "0", {
      get: function () {
        return "from a getter";
      },
    });
    a = "assigned";
    return [a, arguments[0]];
  },
  frozen: function (a) {
    Object.freeze(arguments);
    a = "assigned";
    return [a, arguments[0]];
  },
  frozenThenStored: function (a) {
    Object.freeze(arguments);
    arguments[0] = "stored";
    return [a, arguments[0]];
  },
  sealed: function (a) {
    Object.seal(arguments);
    arguments[0] = "stored";
    return [a, arguments[0]];
  },
  changedElsewhere: function (a) {
    change(arguments);
    return a;
  },
  changedByACallback: function (a) {
    [0].forEach(function () {
      this[0] = "changed by a callback";
    }, arguments);
    return a;
  },
  assigned: function (a) {
    Object.assign(arguments, ["assigned by Object.assign"]);
    return a;
  },
  reflected: function (a) {
    Reflect.set(arguments, 0, "reflected");
    return a;
  },
  sorted: function (a, b) {
    Array.prototype.sort.call(arguments);
    return [a, b];
  },
  reversed: function (a, b) {
    Array.prototype.reverse.call(arguments);
    return [a, b];
  },
  filled: function (a, b) {
    Array.prototype.fill.call(arguments, "filled");
    return [a, b];
  },
  shifted: function (a, b) {
    var taken = Array.prototype.shift.call(arguments);
    return [taken, a, b, arguments.length];
  },
  cut: function (a) {
    arguments.length = 0;
    arguments[0] = "stored";
    return [a, arguments.length];
  },
  reparented: function (a) {
    Object.setPrototypeOf(arguments, { 5: "inherited" });
    arguments[0] = "stored";
    return [a, arguments[5]];
  },
  describedAfterAssignment: function (a) {
    a = "assigned";
    return Object.getOwnPropertyDescriptor(arguments, "0").value;
  },
};
for (var name in uses) attempt(name, uses[name].bind(null, 2, 1));

function leaks(a) {
  return {
    operands: arguments,
    read: function () {
      return a;
    },
    write: function (value) {
      a = value;
    },
  };
}
var leaked = leaks(1);
leaked.operands[0] = "stored after the return";
attempt("a store after the return", () => [leaked.read(), leaked.operands[0]]);
leaked.write("assigned after the return");
attempt("an assignment after the return", () => [leaked.read(), leaked.operands[0]]);

function total(a, b) {
  change(arguments);
  return a + b;
}
function honestTotal(a, b) {
  show(arguments);
  return a + b;
}
var sum = 0;
for (var i = 0; i < 2000; i++) sum += honestTotal(i, 1);
console.log("sum", sum);
attempt("total", () => total(1, 2));
