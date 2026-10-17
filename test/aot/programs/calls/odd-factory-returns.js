function row(label, f) {
  let said;
  try {
    said = f();
  } catch (e) {
    said = "threw " + e.name;
  }
  console.log(label + ": " + String(said));
}
const no = Date.now() < 0;

function plain() {
  return function made(a) {
    return "made " + a;
  };
}

row("read in the dead zone", () => early());
function early() {
  return inTheDeadZone(1);
}
const inTheDeadZone = plain();
row("read behind the dead zone", () => early());

row("a var read before it is stored to", () => hoistedUser());
function hoistedUser() {
  return hoisted(2);
}
var hoisted = plain();
row("a var read afterwards", () => hoistedUser());

function throwing() {
  if (!no) throw new RangeError("no closure");
  return () => "never";
}
row("a maker that throws", () => {
  const made = throwing();
  return made();
});

function overridden() {
  try {
    return () => "from try";
  } finally {
    if (!no) return () => "from finally";
  }
}
const fromFinally = overridden();
row("finally returns something else", () => fromFinally());

function endReached(yes) {
  if (yes) return () => "returned";
}
const reached = endReached(no);
const notReached = endReached(!no);
row("the end of the body is reached", () => reached());
row("the end of the body is not reached", () => notReached());

function localStoredTwice() {
  let f = function () {
    return "first";
  };
  if (!no)
    f = function () {
      return "second";
    };
  return f;
}
const second = localStoredTwice();
row("a local that is stored to twice", () => second());

function declarationStoredTo() {
  function inner() {
    return "declared";
  }
  if (!no) inner = () => "stored";
  return inner;
}
const stored = declarationStoredTo();
row("a declaration that is stored to", () => stored());

function nested() {
  return plain();
}
const ofANestedMaker = nested();
row("a maker that calls a maker", () => ofANestedMaker(3));

function handsBack(f) {
  return f;
}
const handedBack = handsBack(a => "handed back " + a);
row("a maker that hands its argument back", () => handedBack(4));

function bound() {
  return function (a) {
    return this.label + " " + a;
  }.bind({ label: "bound" });
}
const isBound = bound();
row("a maker that binds", () => isBound(5));

function* generating() {
  return () => "from a generator";
}
const generator = generating();
row("a generator function", () => generator());
row("what a generator function makes", () => typeof generator.next);

const asyncArrow = async () => () => "from an async arrow";
const promise = asyncArrow();
row("an async arrow", () => promise());

function Constructed() {
  return function () {
    return "constructed";
  };
}
const constructed = new Constructed();
row("a maker that is constructed", () => constructed());

const optional = plain?.();
row("an optional call", () => optional(6));

function tag() {
  return () => "tagged";
}
const tagged = tag`text`;
row("a tagged template", () => tagged());

const recursive = (function () {
  return function down(n) {
    return n ? recursive(n - 1) + 1 : 0;
  };
})();
row("the closure calls the variable", () => recursive(5));

function withProperties() {
  const made = function (a) {
    made.calls++;
    return a + made.calls;
  };
  made.calls = 0;
  return made;
}
const counted = withProperties();
row("a closure with properties", () => counted(1) + counted(1) + " " + counted.calls + " " + counted.name + " " + counted.length);

function manyClosures(k) {
  return () => k;
}
const closures = [manyClosures(1), manyClosures(2)];
const one = manyClosures(3);
const other = manyClosures(4);
row("several closures of one function", () => [one(), other(), closures[0](), closures[1](), one === other].join());

let replaced = plain();
row("a variable before it is replaced", () => replaced(7));
replaced = a => "replaced " + a;
row("a variable that was replaced", () => replaced(7));

function usesThis() {
  return function () {
    return typeof this;
  };
}
const sloppy = usesThis();
row("this in a sloppy closure", () => sloppy());

function tooFew() {
  return function (a, b = "default", ...rest) {
    return [a, b, rest.length, arguments.length].join();
  };
}
const flexible = tooFew();
row("fewer and more arguments", () => flexible() + " " + flexible(1) + " " + flexible(1, 2, 3, 4));
