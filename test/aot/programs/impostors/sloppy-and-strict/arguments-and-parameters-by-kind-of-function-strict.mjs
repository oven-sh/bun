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

function declared(a) {
  arguments[0] = "stored";
  return a;
}
var expression = function (a) {
  arguments[0] = "stored";
  return a;
};
var holder = {
  method(a) {
    arguments[0] = "stored";
    return a;
  },
  property: function (a) {
    arguments[0] = "stored";
    return a;
  },
  seen: undefined,
  set setter(a) {
    arguments[0] = "stored";
    this.seen = a;
  },
  *generator(a) {
    arguments[0] = "stored";
    yield a;
  },
  async asynchronous(a) {
    arguments[0] = "stored";
    return a;
  },
  ["comp" + "uted"](a) {
    arguments[0] = "stored";
    return a;
  },
};
class Klass {
  constructor(a) {
    arguments[0] = "stored";
    this.seen = a;
  }
  method(a) {
    arguments[0] = "stored";
    return a;
  }
  static method(a) {
    arguments[0] = "stored";
    return a;
  }
  field = function (a) {
    arguments[0] = "stored";
    return a;
  };
}
function Constructor(a) {
  arguments[0] = "stored";
  this.seen = a;
}
function* generator(a) {
  var before = a;
  arguments[0] = "stored";
  yield [before, a];
  arguments[0] = "stored after a yield";
  yield a;
  a = "assigned after a yield";
  yield arguments[0];
}
async function asynchronous(a) {
  arguments[0] = "stored";
  var before = a;
  await null;
  arguments[0] = "stored after an await";
  return [before, a];
}
async function* asynchronousGenerator(a) {
  arguments[0] = "stored";
  yield a;
  await null;
  a = "assigned after an await";
  yield arguments[0];
}
function withAnArrow(a) {
  return (() => {
    arguments[0] = "stored";
    return a;
  })();
}
function withAnInnerFunction(a) {
  return (function () {
    arguments[0] = "stored";
    return a;
  })("inner");
}
var madeOfText = new Function("a", "arguments[0] = 'stored'; return a;");
var madeOfStrictText = new Function("a", "'use strict'; arguments[0] = 'stored'; return a;");
var bound = declared.bind(null);
var boundWithAnOperand = declared.bind(null, "bound operand");

attempt("declared", () => declared(1));
attempt("expression", () => expression(1));
attempt("method", () => holder.method(1));
attempt("property", () => holder.property(1));
attempt("setter", () => ((holder.setter = 1), holder.seen));
attempt("generator method", () => holder.generator(1).next().value);
attempt("computed method", () => holder.computed(1));
attempt("class constructor", () => new Klass(1).seen);
attempt("class method", () => new Klass(1).method(1));
attempt("static method", () => Klass.method(1));
attempt("a function in a field", () => new Klass(1).field(1));
attempt("constructor function", () => new Constructor(1).seen);
attempt("generator", () => Array.from(generator(1)));
attempt("with an arrow", () => withAnArrow(1));
attempt("with an inner function", () => withAnInnerFunction(1));
attempt("made of text", () => madeOfText(1));
attempt("made of strict text", () => madeOfStrictText(1));
attempt("bound", () => bound(1));
attempt("bound with an operand", () => boundWithAnOperand(1));
var sum = 0;
for (var i = 0; i < 2000; i++) sum += String(declared(i)).length + String(holder.method(i)).length + String(Klass.method(i)).length;
console.log("sum", sum);
(async function () {
  console.log("async method", show(await holder.asynchronous(1)));
  console.log("async", show(await asynchronous(1)));
  var seen = [];
  for await (var item of asynchronousGenerator(1)) seen.push(item);
  console.log("async generator", show(seen));
})();

export {};
