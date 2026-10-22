// Of one binding some reads come behind its declaration on every path and others may come too early.
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error.constructor.name);
  }
}

// A function reads too early once; the body reads behind the declaration.
function readFirst() {
  return first;
}
attempt("first, early", readFirst);
const first = { name: "first" };
console.log("first, in the body", first.name);
attempt("first, late", readFirst);

// A store in the dead zone throws and is caught. The read behind it is still too early.
attempt("second, stored early", () => {
  second = 5;
  return second;
});
try {
  second = 6;
} catch (error) {
  console.log("second, store in the body", error.constructor.name);
}
attempt("second, read in a function", () => second);
try {
  console.log("second, read in the body", second);
} catch (error) {
  console.log("second, read in the body", error.constructor.name);
}
let second = 1;
console.log("second, behind the declaration", second);
second = 2;
console.log("second, behind a store", second);

// The function that stores is called once, in a try block, in front of the declaration.
function storeThird() {
  third = 30;
}
try {
  storeThird();
} catch (error) {
  console.log("third, stored early", error.constructor.name);
}
try {
  console.log("third", third);
} catch (error) {
  console.log("third, read early", error.constructor.name);
}
let third = 3;
console.log("third", third);

// One arm declares, the other jumps past the declaration.
function inSwitch(key) {
  switch (key) {
    case 0:
      let held = "stored";
      held += ", and changed";
      console.log("switch, behind the declaration", held);
    case 1:
      held += ", twice";
      return held;
  }
}
attempt("switch 0", () => inSwitch(0));
attempt("switch 1", () => inSwitch(1));

// Each turn of a loop has a binding of its own, which starts empty again.
function inLoop(turns) {
  const seen = [];
  for (let turn = 0; turn < turns; turn++) {
    const read = () => own;
    if (turn === 2) {
      try {
        seen.push(read());
      } catch (error) {
        seen.push(error.constructor.name);
      }
    }
    const own = turn * 10;
    seen.push(read(), own);
  }
  return seen.join(",");
}
console.log("loop", inLoop(4));

// The initializer throws: the binding stays empty for whoever got hold of a reader.
let leaked;
function failing() {
  throw new RangeError("no value");
}
function withFailingInitializer() {
  leaked = () => never;
  const never = failing();
  return never;
}
attempt("initializer throws", withFailingInitializer);
attempt("the reader that leaked", () => leaked());

// The initializer reads its own binding.
attempt("reads itself", () => {
  const self = (() => self)() + 1;
  return self;
});

// A class is named in its own heritage and in a static block.
attempt("class in its heritage", () => {
  class Later extends Later {}
  return Later.name;
});
class Counted {
  static made = 0;
  static {
    Counted.made = 1;
  }
  static create() {
    Counted.made++;
    return new Counted();
  }
}
console.log("class", Counted.create() instanceof Counted, Counted.made);

// typeof does not forgive the dead zone.
attempt("typeof", () => typeof fourth);
const fourth = 4;
attempt("typeof", () => typeof fourth);

// A default value reads a later parameter, and a closure in a default value reads a binding of the body's scope.
function parameters(a = b, b = 1) {
  return [a, b];
}
attempt("parameters", () => parameters());
attempt("parameters", () => parameters(1));

// A generator stops in front of the declaration.
function* stepwise() {
  const read = () => late;
  yield read;
  const late = "late";
  yield read;
  yield late;
}
const steps = stepwise();
const early = steps.next().value;
attempt("generator, early", early);
steps.next();
attempt("generator, late", early);
console.log("generator", steps.next().value);
