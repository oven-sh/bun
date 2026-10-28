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

function inACase(key) {
  switch (key) {
    case 1:
      function chosen() {
        return "declared under case 1";
      }
      break;
    case 2:
      return typeof chosen === "function" ? chosen() : typeof chosen;
  }
  return typeof chosen;
}
function inALoop(rounds) {
  var made = [];
  for (var i = 0; i < rounds; i++) {
    function counter() {
      return i;
    }
    made.push(counter);
  }
  return [made.length, made.length > 1 && made[0] === made[1], typeof counter, made.map(each => each())];
}
function inALoopWithLet(rounds) {
  var made = [];
  for (let i = 0; i < rounds; i++) {
    function counter() {
      return i;
    }
    made.push(counter);
  }
  return [made.map(each => each()), typeof counter === "function" ? counter() : typeof counter];
}
function inTry(fail) {
  try {
    if (fail) throw new Error("before the declaration is reached");
    function made() {
      return "made in try";
    }
  } catch (error) {
    return typeof made;
  }
  return typeof made;
}
function inCatch() {
  try {
    throw 1;
  } catch (error) {
    function handler() {
      return typeof error;
    }
  }
  return typeof handler === "function" ? handler() : typeof handler;
}
function inFinally() {
  try {
  } finally {
    function last() {
      return "made in finally";
    }
  }
  return typeof last;
}
function underALabel() {
  block: {
    function labelled() {}
    break block;
  }
  return typeof labelled;
}
function deep() {
  {
    {
      {
        function buried() {
          return "buried";
        }
      }
    }
    var halfway = typeof buried;
  }
  return [halfway, typeof buried];
}
function generatorInABlock() {
  {
    function* made() {}
  }
  return typeof made;
}
function asyncInABlock() {
  {
    async function made() {}
  }
  return typeof made;
}
function classInABlock() {
  {
    class Made {}
  }
  return typeof Made;
}

attempt("inACase(1)", () => inACase(1));
attempt("inACase(2)", () => inACase(2));
attempt("inACase(3)", () => inACase(3));
attempt("inALoop(0)", () => inALoop(0));
attempt("inALoop(3)", () => inALoop(3));
attempt("inALoopWithLet(0)", () => inALoopWithLet(0));
attempt("inALoopWithLet(3)", () => inALoopWithLet(3));
attempt("inTry(false)", () => inTry(false));
attempt("inTry(true)", () => inTry(true));
var uses = { inCatch, inFinally, underALabel, deep, generatorInABlock, asyncInABlock, classInABlock };
for (var name in uses) attempt(name, uses[name]);
