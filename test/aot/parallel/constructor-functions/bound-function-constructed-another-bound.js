// A bound function constructed for another bound function makes an ordinary object.
function attempt(label, run) {
  try {
    run();
  } catch (error) {
    console.log(label, "throws", error.constructor.name);
  }
}

function Stores(a) {
  this.x = a;
  this.y = "y";
}
const stored = Reflect.construct(Stores.bind(null), [2.5], Object.bind(null));
console.log(
  Object.keys(stored).join(),
  JSON.stringify(stored),
  JSON.stringify({ ...stored }),
  stored.x,
  stored.y,
  Object.hasOwn(stored, "x"),
  Reflect.ownKeys(stored).join(),
);
console.log({} instanceof Stores);

function ForOtherFunction(a) {
  this.x = a;
  this.y = "y";
}
function Other() {
  this.z = 1;
}
{
  const made = Reflect.construct(ForOtherFunction.bind(null), [1], Other.bind(null));
  console.log(
    "for another function, bound",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForOtherFunction,
  );
}
console.log(new Other() instanceof Other, Object.keys(new Other()).join());

function BoundTwice(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = Reflect.construct(BoundTwice.bind(null).bind(null), [2], Object.bind(null));
  console.log(
    "bound twice",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof BoundTwice,
  );
}

function ForTargetBoundTwice(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = Reflect.construct(ForTargetBoundTwice.bind(null), [3], Object.bind(null).bind(null));
  console.log(
    "for a target bound twice",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForTargetBoundTwice,
  );
}

function WithBoundArgument(a, b) {
  this.x = a;
  this.y = b;
}
{
  const made = Reflect.construct(WithBoundArgument.bind(null, 4), ["later"], Object.bind(null));
  console.log(
    "with a bound argument",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof WithBoundArgument,
  );
}

function ForBoundClass(a) {
  this.x = a;
  this.y = "y";
}
class Plain {
  z = 1;
}
{
  const made = Reflect.construct(ForBoundClass.bind(null), [10], Plain.bind(null));
  console.log(
    "for a bound class",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForBoundClass,
  );
}
console.log(Object.keys(new Plain()).join());

function ForArrow(a) {
  this.x = a;
  this.y = "y";
}
attempt("for an arrow", () => {
  const made = Reflect.construct(ForArrow.bind(null), [11], () => {});
  console.log(
    "for an arrow",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForArrow,
  );
});
attempt("for a bound arrow", () => {
  const made = Reflect.construct(ForArrow.bind(null), [11], (() => {}).bind(null));
  console.log(
    "for a bound arrow",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForArrow,
  );
});
attempt("for a method", () => {
  const made = Reflect.construct(ForArrow.bind(null), [11], { method() {} }.method);
  console.log(
    "for a method",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForArrow,
  );
});
attempt("for nothing", () => {
  const made = Reflect.construct(ForArrow.bind(null), [11], undefined);
  console.log(
    "for nothing",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForArrow,
  );
});
{
  const made = Reflect.construct(ForArrow.bind(null), [11]);
  console.log(
    "for no third operand",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForArrow,
  );
}

const bindToNothing = callee => callee.bind(null);
function BoundAtOnePlace(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = Reflect.construct(bindToNothing(BoundAtOnePlace), [12], bindToNothing(Object));
  console.log(
    "both bound at one place",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof BoundAtOnePlace,
  );
}

function ForOwnPrototype(a) {
  this.x = a;
  this.y = "y";
}
const withOwnPrototype = Object.bind(null);
withOwnPrototype.prototype = { tag: "own" };
const madeForOwnPrototype = Reflect.construct(ForOwnPrototype.bind(null), [13], withOwnPrototype);
{
  const made = madeForOwnPrototype;
  console.log(
    "for a bound function with a prototype of its own",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForOwnPrototype,
  );
}
console.log(madeForOwnPrototype.tag);

function ForPrototypeOfMaker(a) {
  this.x = a;
  this.y = "y";
}
const withPrototypeOfMaker = Object.bind(null);
withPrototypeOfMaker.prototype = ForPrototypeOfMaker.prototype;
{
  const made = Reflect.construct(ForPrototypeOfMaker.bind(null), [14], withPrototypeOfMaker);
  console.log(
    "for a bound function with the prototype of the maker",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForPrototypeOfMaker,
  );
}

function ForItself(a) {
  this.x = a;
  this.y = "y";
}
const boundForItself = ForItself.bind(null);
{
  const made = Reflect.construct(boundForItself, [15], boundForItself);
  console.log(
    "for the bound function itself",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForItself,
  );
}

function BoundInTwoWays(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = Reflect.construct(BoundInTwoWays.bind(null), [16], BoundInTwoWays.bind(null));
  console.log(
    "for another bound function of the maker",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof BoundInTwoWays,
  );
}

class Base {
  constructor(a) {
    this.x = a;
    this.y = "y";
  }
}
{
  const made = Reflect.construct(Base.bind(null), [17], Object.bind(null));
  console.log(
    "a bound class",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof Base,
  );
}

class WithFields {
  x = 18;
  y = "y";
}
{
  const made = Reflect.construct(WithFields.bind(null), [], Object.bind(null));
  console.log(
    "a bound class with fields",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof WithFields,
  );
}

class Above {
  constructor(a) {
    this.x = a;
  }
}
class Below extends Above {
  constructor(a) {
    super(a);
    this.y = "y";
  }
}
{
  const made = Reflect.construct(Below.bind(null), [19], Object.bind(null));
  console.log(
    "a bound class below another",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof Below,
  );
}
console.log(Object.keys(new Below(1)).join(), new Below(1) instanceof Above);

function WithNew(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = new (WithNew.bind(null))(20);
  console.log(
    "new of a bound function",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof WithNew,
  );
}

function BelowBound(a) {
  this.x = a;
  this.y = "y";
}
attempt("a class below a bound function", () => {
  class Heir extends BelowBound.bind(null) {}
  {
    const made = new Heir(21);
    console.log(
      "a class below a bound function",
      Object.keys(made).join(),
      JSON.stringify(made),
      JSON.stringify({ ...made }),
      JSON.stringify(Object.assign({}, made)),
      JSON.stringify(Object.entries(made)),
      Reflect.ownKeys(made).join(),
      Object.hasOwn(made, "x"),
      made.x,
      made.y,
      made instanceof BelowBound,
    );
  }
});
const boundWithPrototype = BelowBound.bind(null);
boundWithPrototype.prototype = BelowBound.prototype;
class HeirOfPrototype extends boundWithPrototype {}
{
  const made = new HeirOfPrototype(21);
  console.log(
    "a class below a bound function with a prototype",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof BelowBound,
  );
}
console.log(new HeirOfPrototype(1) instanceof HeirOfPrototype);

function Often(a) {
  this.x = a;
  this.y = "y";
}
const boundOften = Often.bind(null);
const targetOften = Object.bind(null);
let keysSeen = 0;
let sum = 0;
for (let index = 0; index < 2000; index++) {
  const made = index % 2 ? Reflect.construct(boundOften, [index], targetOften) : new Often(index);
  keysSeen += Object.keys(made).length + (made instanceof Often ? 10 : 0);
  sum += made.x;
}
console.log("often", keysSeen, sum);

function NeverRuns(a) {
  this.x = a;
  this.y = "y";
}
const ordinary = Reflect.construct(Object.bind(null), [], NeverRuns.bind(null));
console.log(
  "Object for a bound function",
  Object.keys(ordinary).join(),
  ordinary instanceof NeverRuns,
  Object.getPrototypeOf(ordinary) === Object.prototype,
);
const list = Reflect.construct(Array.bind(null), [3], NeverRuns.bind(null));
console.log(
  "Array for a bound function",
  list.length,
  Array.isArray(list),
  list instanceof NeverRuns,
  Object.getPrototypeOf(list) === Array.prototype,
);

function BoundThroughApply(a, b) {
  this.x = a;
  this.y = b;
}
{
  const made = Reflect.construct(
    Function.prototype.bind.apply(BoundThroughApply, [null, 22]),
    ["y"],
    Function.prototype.bind.call(Object, null),
  );
  console.log(
    "bound through apply",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof BoundThroughApply,
  );
}

function ReadsNewTarget(a) {
  this.x = a;
  this.y = typeof new.target.prototype;
}
const targetRead = Object.bind(null);
{
  const made = Reflect.construct(ReadsNewTarget.bind(null), [23], targetRead);
  console.log(
    "reads new.target",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ReadsNewTarget,
  );
}

function AnswersOtherObject(a) {
  this.x = a;
  this.y = "y";
  return { x: "other", y: this };
}
const other = Reflect.construct(AnswersOtherObject.bind(null), [24], Object.bind(null));
{
  const made = other.y;
  console.log(
    "what the maker left behind",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof AnswersOtherObject,
  );
}

function GrowsLater(a) {
  this.x = a;
  this.y = "y";
}
const grown = Reflect.construct(GrowsLater.bind(null), [25], Object.bind(null));
grown.z = 1;
delete grown.x;
{
  const made = grown;
  console.log(
    "grows and shrinks later",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof GrowsLater,
  );
}
