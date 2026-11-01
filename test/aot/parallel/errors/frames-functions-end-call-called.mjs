// A function that ends in `return callee(..)` leaves the stack where it is called and stays in the stack trace where it is constructed. Each row prints the names and the places of the frames.
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(1, 7)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/\(?[^ (]*\.mjs:/, "(")
        .replace(/^\((\d+:\d+)$/, "($1)"),
    )
    .join(" < ");
function attempt(label, run) {
  try {
    run();
    console.log(label + ": nothing");
  } catch (error) {
    console.log(label + ": " + frames(error));
  }
}
function fail(value) {
  throw new TypeError("thrown " + value);
}
function failOtherwise(value) {
  throw new SyntaxError("thrown otherwise " + value);
}
function other() {}
const held = [fail];
const holder = {
  fail(value) {
    throw new RangeError("held " + value);
  },
};

function handsOn(value) {
  return fail(value);
}
function callsValue(value) {
  return held[0](value);
}
function callsMember(value) {
  return holder.fail(value);
}
function storesFirst(value) {
  this.value = value;
  return fail(value);
}
function hasTwoCallees(value) {
  return value ? fail(value) : failOtherwise(value);
}
function startsChain(value) {
  return middle(value);
}
function middle(value) {
  return fail(value);
}
function constructsBelow(value) {
  return constructs(value);
}
function constructs(value) {
  const made = new handsOn(value);
  return made;
}
function returnsInTry(value) {
  try {
    return fail(value);
  } finally {
    other();
  }
}
function loopsFirst(value) {
  let sum = 0;
  for (let i = 0; i < value; i++) sum += i;
  if (sum > 100) other();
  return fail(sum);
}
function callsBuiltIn(value) {
  return JSON.parse(value);
}
function captures(value) {
  return capture(value);
}
function capture() {
  const target = {};
  Error.captureStackTrace(target);
  throw Object.assign(new Error("captured"), { stack: target.stack });
}
function capturesBelow(value) {
  return captureBelow(value);
}
function captureBelow() {
  const target = {};
  Error.captureStackTrace(target, captureBelow);
  throw Object.assign(new Error("captured"), { stack: target.stack });
}
function capturesBelowItself(value) {
  return captureBelowCaller(value);
}
function captureBelowCaller() {
  const target = {};
  Error.captureStackTrace(target, capturesBelowItself);
  throw Object.assign(new Error("captured"), { stack: target.stack });
}
const all = [
  handsOn,
  callsValue,
  callsMember,
  storesFirst,
  hasTwoCallees,
  startsChain,
  constructsBelow,
  returnsInTry,
  loopsFirst,
  callsBuiltIn,
  captures,
  capturesBelow,
  capturesBelowItself,
];
for (const f of all) {
  attempt(f.name + ", called", () => {
    f(1);
  });
  attempt(f.name + ", constructed", () => {
    new f(1);
  });
  attempt(f.name + ", constructed and kept", () => {
    const made = new f(1);
    return made;
  });
  attempt(f.name + ", constructed and returned", () => new f(1));
  attempt(f.name + ", by Reflect.construct", () => {
    Reflect.construct(f, [1]);
  });
  attempt(f.name + ", by Reflect.construct for another", () => {
    Reflect.construct(f, [1], other);
  });
  attempt(f.name + ", bound", () => {
    new (f.bind(null))(1);
  });
  attempt(f.name + ", behind a proxy", () => {
    new new Proxy(f, {})(1);
  });
  attempt(f.name + ", behind a proxy by Reflect.construct", () => {
    Reflect.construct(new Proxy(f, {}), [1]);
  });
  attempt(f.name + ", as a parent", () => {
    new (class extends f {})(1);
  });
  attempt(f.name + ", as a parent whose heir calls super", () => {
    new (class extends f {
      constructor(value) {
        super(value);
      }
    })(1);
  });
  attempt(f.name + ", with a spread", () => {
    new f(...[1]);
  });
}

function written(value) {
  return fail(value);
}
attempt("written, called", () => {
  written(1);
});
attempt("written, constructed", () => {
  new written(1);
});
function writtenForReflect(value) {
  return fail(value);
}
attempt("written, by Reflect.construct", () => {
  Reflect.construct(writtenForReflect, [1]);
});
attempt("written, called too", () => {
  writtenForReflect(1);
});

function callsWhatItIsHanded(run, value) {
  return run(value);
}
attempt("a built-in function by value, constructed", () => {
  new callsWhatItIsHanded(JSON.parse, "{");
});
attempt("a built-in function by value, called", () => {
  callsWhatItIsHanded(JSON.parse, "{");
});
attempt("a built-in function by value, by Reflect.construct", () => {
  Reflect.construct(callsWhatItIsHanded, [JSON.parse, "{"]);
});

// What the callee returns is an object that the callee of the callee makes.
const trace = () => ({ trace: frames(new Error("trace")) });
function declared() {
  return trace();
}
function forwards(value) {
  return declared(value);
}
console.log("an object handed down, called: " + forwards(1).trace);
console.log("an object handed down, constructed: " + new forwards(1).trace);
console.log("an object handed down, by Reflect.construct: " + Reflect.construct(forwards, [1]).trace);

for (const limit of [1, 2, 3]) {
  Error.stackTraceLimit = limit;
  attempt("at most " + limit + ", constructed", () => {
    new startsChain(1);
  });
  attempt("at most " + limit + ", called", () => {
    startsChain(1);
  });
  attempt("at most " + limit + ", by Reflect.construct", () => {
    Reflect.construct(startsChain, [1]);
  });
}
Error.stackTraceLimit = 10;

Error.prepareStackTrace = (error, sites) =>
  sites
    .slice(0, 4)
    .map(
      site =>
        (site.isConstructor() ? "new " : "") +
        site.getFunctionName() +
        ":" +
        site.getLineNumber() +
        ":" +
        site.getColumnNumber() +
        (site.isToplevel() ? " top" : "") +
        (site.isNative() ? " native" : "") +
        " " +
        typeof site.getFunction() +
        " " +
        typeof site.getThis(),
    )
    .join(" < ");
for (const f of [handsOn, callsValue, storesFirst, startsChain]) {
  for (const [label, run] of [
    ["constructed", () => new f(1)],
    ["called", () => f(1)],
    ["by Reflect.construct", () => Reflect.construct(f, [1])],
  ]) {
    try {
      run();
    } catch (error) {
      console.log("call sites of " + f.name + ", " + label + ": " + error.stack);
    }
  }
}
