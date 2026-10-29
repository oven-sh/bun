// The steps of a generator that end in an error or run nothing: next, return and throw on a generator that is running, that has completed, that has not started or that belongs to another realm, and on receivers that are not generators. After each group a plain loop over next() still gets every value.
// CALLS+ drainSameRealm StepGenerator
const lines = [];

function attempt(label, action) {
  try {
    const step = action();
    lines.push(label + ": " + String(step.value) + " " + step.done);
  } catch (error) {
    lines.push(label + ": threw " + String(error));
  }
}

const kinds = ["next", "return", "throw"];
const steps = {
  next: generator => generator.next("sent"),
  return: generator => generator.return("returned"),
  throw: generator => generator.throw(new RangeError("thrown")),
};

function* count(limit) {
  for (let i = 0; i < limit; i++) yield i;
  return "end";
}
function* echoes() {
  let sent = yield "ready";
  while (sent !== "stop") sent = yield "echo " + sent;
  return "stopped";
}
function sumByNext(limit) {
  const generator = count(limit);
  let total = 0;
  for (let step = generator.next(); !step.done; step = generator.next()) total += step.value;
  return total;
}
function drain(generator) {
  const seen = [];
  let step = generator.next();
  while (!step.done) {
    seen.push(step.value);
    step = generator.next();
  }
  seen.push(step.value);
  return seen.join();
}
function drainSameRealm(generator) {
  const seen = [];
  let step = generator.next();
  while (!step.done) {
    seen.push(step.value);
    step = generator.next();
  }
  seen.push(step.value);
  return seen.join();
}
function plainLoops() {
  const echo = echoes();
  const answers = [echo.next("dropped"), echo.next(1), echo.next("two"), echo.next("stop"), echo.next("late")].map(step => step.value + " " + step.done);
  lines.push("plain loops: " + [sumByNext(0), sumByNext(1), sumByNext(10000), drain(count(3)), drainSameRealm(count(3)), drainSameRealm(count(0)), answers.join()].join(" | "));
}
plainLoops();

let current;
function* reentrant(kind) {
  attempt("  " + kind + " before the first yield", () => steps[kind](current));
  const sent = yield "first";
  attempt("  " + kind + " after a yield that got " + sent, () => steps[kind](current));
  try {
    yield "second";
  } finally {
    attempt("  " + kind + " in finally", () => steps[kind](current));
  }
  return "end";
}
for (const kind of kinds) {
  lines.push("== running, " + kind);
  current = reentrant(kind);
  attempt("first next", () => current.next());
  attempt("second next", () => current.next("a value"));
  attempt("return at the second yield", () => current.return("stopped"));
  attempt("next after the end", () => current.next());
}

function* iteratesItself() {
  try {
    for (const value of current) lines.push("  for-of got " + value);
  } catch (error) {
    lines.push("  for-of: threw " + String(error));
  }
  try {
    lines.push("  spread got " + [...current].length);
  } catch (error) {
    lines.push("  spread: threw " + String(error));
  }
  try {
    const [first] = current;
    lines.push("  destructuring got " + first);
  } catch (error) {
    lines.push("  destructuring: threw " + String(error));
  }
  try {
    yield* current;
  } catch (error) {
    lines.push("  yield*: threw " + String(error));
  }
  yield "goes on";
}
lines.push("== running, iterated by its own body");
current = iteratesItself();
attempt("first next", () => current.next());
attempt("second next", () => current.next());

function* stepsOuter() {
  for (const kind of kinds) attempt("  " + kind + " of the outer one from an inner body", () => steps[kind](current));
  yield "inner";
}
function* runsInner() {
  yield stepsOuter().next().value;
  yield "outer";
}
lines.push("== running, stepped from the body of another generator");
current = runsInner();
attempt("first next", () => current.next());
attempt("second next", () => current.next());
attempt("third next", () => current.next());
plainLoops();

function* fails() {
  yield 1;
  throw new Error("inside");
}
function ignoringErrors(action) {
  try {
    action();
  } catch {}
}
const completedBy = {
  "running to the end"() {
    const generator = count(1);
    generator.next();
    generator.next();
    return generator;
  },
  "return at a yield"() {
    const generator = count(3);
    generator.next();
    generator.return("stopped");
    return generator;
  },
  "throw at a yield"() {
    const generator = count(3);
    generator.next();
    ignoringErrors(() => generator.throw(new Error("outside")));
    return generator;
  },
  "an error in the body"() {
    const generator = fails();
    generator.next();
    ignoringErrors(() => generator.next());
    return generator;
  },
  "return before the start"() {
    const generator = count(3);
    generator.return("early");
    return generator;
  },
  "throw before the start"() {
    const generator = count(3);
    ignoringErrors(() => generator.throw(new Error("early")));
    return generator;
  },
};
lines.push("== completed");
for (const [how, complete] of Object.entries(completedBy)) {
  for (const kind of kinds) attempt("by " + how + ", " + kind, () => steps[kind](complete()));
  const generator = complete();
  for (const kind of ["throw", "next", "return", "next"]) attempt("by " + how + ", then in turn " + kind, () => steps[kind](generator));
}
plainLoops();

function* guarded() {
  lines.push("  the body runs");
  try {
    yield "from the body";
  } finally {
    lines.push("  finally runs");
  }
}
lines.push("== not started");
{
  let generator = guarded();
  attempt("throw", () => generator.throw(new RangeError("early")));
  attempt("next after that", () => generator.next());
  generator = guarded();
  attempt("return", () => generator.return("early"));
  attempt("next after that", () => generator.next());
  generator = guarded();
  attempt("throw of nothing", () => generator.throw());
  attempt("return after that", () => generator.return("late"));
  generator = guarded();
  attempt("return of nothing", () => generator.return());
  attempt("throw after that", () => generator.throw("late"));
  generator = guarded();
  attempt("next with a value", () => generator.next("dropped"));
  attempt("return at the yield", () => generator.return("stopped"));
}
plainLoops();

const otherRealm = typeof createGlobalObject === "function" ? createGlobalObject() : require("node:vm").runInNewContext("globalThis");
const theirCount = otherRealm.Function("return function* (limit) { for (let i = 0; i < limit; i++) yield 'their ' + i; return 'their end'; }")();
const theirReentrant = otherRealm.Function("return function* (callback) { callback('their generator'); yield 'their yield'; }")();
const ourMethods = Object.getPrototypeOf(count.prototype);
const theirMethods = Object.getPrototypeOf(theirCount.prototype);
const methodsOf = [
  ["our", ourMethods],
  ["their", theirMethods],
];
function realmOf(error) {
  if (error instanceof TypeError) return "our TypeError";
  if (error instanceof otherRealm.TypeError) return "their TypeError";
  return "not a TypeError";
}
function* delegatesToTheirs() {
  yield "got " + (yield* theirCount(2));
}
function* ourReentrant(callback) {
  callback("our generator");
  yield "our yield";
}

lines.push("== another realm, with methods of its own: " + (ourMethods !== theirMethods));
for (const [whose, methods] of methodsOf) {
  for (const [owner, make] of [
    ["our", count],
    ["their", theirCount],
  ]) {
    const name = whose + " methods on " + owner + " generator";
    let generator = make(2);
    attempt(name + ", next", () => methods.next.call(generator));
    attempt(name + ", next", () => methods.next.call(generator));
    attempt(name + ", next at the end", () => methods.next.call(generator));
    attempt(name + ", next after the end", () => methods.next.call(generator));
    attempt(name + ", return after the end", () => methods.return.call(generator, "returned"));
    attempt(name + ", throw after the end", () => methods.throw.call(generator, "thrown"));
    generator = make(2);
    attempt(name + ", return before the start", () => methods.return.call(generator, "early"));
    attempt(name + ", next after that", () => methods.next.call(generator));
    generator = make(2);
    attempt(name + ", throw before the start", () => methods.throw.call(generator, "early"));
    attempt(name + ", next after that", () => methods.next.call(generator));
    generator = make(2);
    attempt(name + ", next", () => methods.next.call(generator));
    attempt(name + ", return at a yield", () => methods.return.call(generator, "stopped"));
    attempt(name + ", next after that", () => methods.next.call(generator));
  }
}
{
  let running;
  const stepRunning = which => {
    for (const [whose, methods] of methodsOf) {
      for (const kind of kinds) {
        try {
          methods[kind].call(running, "again");
          lines.push("  " + which + " is running, " + whose + " " + kind + ": did not throw");
        } catch (error) {
          lines.push("  " + which + " is running, " + whose + " " + kind + ": " + realmOf(error) + ", " + error.message);
        }
      }
    }
  };
  running = theirReentrant(stepRunning);
  attempt("next of theirs", () => running.next());
  attempt("next of theirs", () => running.next());
  running = ourReentrant(stepRunning);
  attempt("next of ours", () => running.next());
  attempt("next of ours", () => running.next());
}
{
  const seen = [];
  for (const value of theirCount(3)) seen.push(value);
  lines.push("for-of over theirs: " + seen.join());
  lines.push("spread of theirs: " + [...theirCount(2)].join());
  lines.push("drained by next: " + drain(theirCount(2)));
  lines.push("yield* of theirs: " + [...delegatesToTheirs()].join());
  lines.push("ours spread by them: " + otherRealm.Function("iterable", "return [...iterable].join()")(count(3)));
  lines.push("ours drained by them: " + otherRealm.Function("generator", "let seen = ''; for (let step = generator.next(); !step.done; step = generator.next()) seen += step.value; return seen;")(count(3)));
}
plainLoops();

async function* asyncCount() {
  yield 1;
}
const receivers = [
  ["undefined", undefined],
  ["null", null],
  ["a number", 1],
  ["a string", "text"],
  ["a symbol", Symbol.iterator],
  ["an object", {}],
  ["an array", []],
  ["a generator function", count],
  ["the prototype of a generator function", count.prototype],
  ["the object with the methods", ourMethods],
  ["an object that inherits from a generator", Object.create(count(1))],
  ["a proxy of a generator", new Proxy(count(1), {})],
  ["an async generator", asyncCount()],
  ["an array iterator", [][Symbol.iterator]()],
];
lines.push("== receivers that are not generators");
for (const [what, receiver] of receivers) {
  for (const kind of kinds) attempt(what + ", " + kind, () => ourMethods[kind].call(receiver, "value"));
}
attempt("a method call on an object that inherits from a generator", () => Object.create(count(1)).next());
attempt("a method call on a proxy of a generator", () => new Proxy(count(1), {}).next());
plainLoops();

console.log(lines.join("\n"));
