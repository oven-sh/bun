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

function afterTheBlock() {
  {
    function inner() {
      return "inner";
    }
  }
  return typeof inner;
}
function beforeTheBlock() {
  var before = typeof inner;
  {
    function inner() {
      return "inner";
    }
  }
  return before;
}
function blockNotEntered(enter) {
  if (enter) {
    function inner() {
      return "inner";
    }
  }
  return typeof inner;
}
function calledAfterTheBlock(enter) {
  if (enter) {
    function inner() {
      return "inner";
    }
  }
  return inner();
}
function hoistedInsideTheBlock() {
  {
    var early = inner();
    function inner() {
      return "inner";
    }
  }
  return early;
}
function twoBlocks(first) {
  if (first) {
    function pick() {
      return "first";
    }
  } else {
    function pick() {
      return "second";
    }
  }
  return pick();
}
function outerOfTheSameName() {
  return "the outer function";
}
function hidesAnOuterFunction(enter) {
  var before = typeof outerOfTheSameName === "function" ? outerOfTheSameName() : typeof outerOfTheSameName;
  if (enter) {
    function outerOfTheSameName() {
      return "the function of the block";
    }
  }
  var after = typeof outerOfTheSameName === "function" ? outerOfTheSameName() : typeof outerOfTheSameName;
  return [before, after];
}
function storedInsideTheBlock() {
  {
    function inner() {
      return "inner";
    }
    inner = "stored inside";
  }
  return typeof inner;
}
function storedBeforeTheDeclaration() {
  {
    inner = "stored first";
    function inner() {}
    var inside = typeof inner;
  }
  return [inside, typeof inner];
}
function usedLikeANumber(enter) {
  var total = 0;
  if (enter) {
    function step() {
      return 2;
    }
  }
  for (var i = 0; i < 3; i++) total += step();
  return total;
}

var uses = { afterTheBlock, beforeTheBlock, blockNotEntered, calledAfterTheBlock, hoistedInsideTheBlock, twoBlocks, hidesAnOuterFunction, storedInsideTheBlock, storedBeforeTheDeclaration, usedLikeANumber };
for (var name in uses) {
  attempt(name + "(true)", uses[name].bind(null, true));
  attempt(name + "(false)", uses[name].bind(null, false));
}
for (var i = 0; i < 2000; i++) {
  try {
    calledAfterTheBlock(true);
  } catch (error) {}
}
attempt("after 2000 calls that entered the block", () => calledAfterTheBlock(false));
{
  function atTheTopLevel() {
    return "declared in a block at the top level";
  }
}
attempt("a block at the top level", () => typeof atTheTopLevel);
attempt("on the global object", () => typeof globalThis.atTheTopLevel);
