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

function parameterOfTheSameName(taken) {
  {
    function taken() {
      return "the function";
    }
  }
  return typeof taken;
}
function parameterUsedLikeANumber(taken) {
  {
    function taken() {}
  }
  return taken + 1;
}
function parameterUsedLikeAList(taken) {
  if (taken.length > 1) {
    function taken() {}
  }
  return taken.length;
}
function letOfTheSameName() {
  let taken = "the let";
  {
    function taken() {}
  }
  return typeof taken;
}
function constInAnOuterBlock() {
  {
    const taken = "the const";
    {
      function taken() {}
    }
    var seen = typeof taken;
  }
  return [seen, typeof taken];
}
function varOfTheSameName() {
  var taken = "the var";
  {
    function taken() {}
  }
  return typeof taken;
}
function varDeclaredLater() {
  {
    function taken() {}
  }
  var taken;
  return typeof taken;
}
function catchParameter() {
  try {
    throw "thrown";
  } catch (taken) {
    {
      function taken() {}
    }
    var seen = typeof taken;
  }
  return [seen, typeof taken];
}
function loopVariable() {
  var kinds = [];
  for (let taken = 0; taken < 2; taken++) {
    {
      function taken() {}
    }
    kinds.push(typeof taken);
  }
  return [kinds, typeof taken];
}
function functionOfTheSameNameOutside() {
  function taken() {
    return "outside";
  }
  {
    function taken() {
      return "inside";
    }
  }
  return taken();
}
function ownName() {
  {
    function ownName() {
      return "inside";
    }
  }
  return ownName === globalThis.keptOwnName;
}
globalThis.keptOwnName = ownName;

var uses = { parameterOfTheSameName, parameterUsedLikeANumber, letOfTheSameName, constInAnOuterBlock, varOfTheSameName, varDeclaredLater, catchParameter, loopVariable, functionOfTheSameNameOutside, ownName };
for (var name in uses) attempt(name, uses[name].bind(null, 1));
attempt("parameterUsedLikeAList, short", () => parameterUsedLikeAList([1]));
attempt("parameterUsedLikeAList, long", () => parameterUsedLikeAList([1, 2]));
var sum = 0;
for (var i = 0; i < 2000; i++) sum += parameterUsedLikeAList([i]);
console.log("sum", sum);
attempt("parameterUsedLikeAList, long, after 2000 short ones", () => parameterUsedLikeAList([1, 2, 3]));
delete globalThis.keptOwnName;
