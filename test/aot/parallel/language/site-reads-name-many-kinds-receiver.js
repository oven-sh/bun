// One site reads one name of receivers that take turns: objects of several shapes, with the property their own, inherited, computed or absent, and primitives, which answer from their prototypes.
function tagOf(value) {
  return value.tag;
}

function describe(value) {
  try {
    return String(tagOf(value));
  } catch (error) {
    return error.constructor.name;
  }
}

Number.prototype.tag = "number";
Boolean.prototype.tag = "boolean";
String.prototype.tag = "string";
Symbol.prototype.tag = "symbol";
BigInt.prototype.tag = "bigint";

class Base {
  get tag() {
    return "getter of " + this.name;
  }
}
class Heir extends Base {
  constructor(name) {
    super();
    this.name = name;
  }
}
function Plain(tag) {
  this.tag = tag;
}
const many = {};
for (let i = 0; i < 40; i++) many["k" + i] = i;
many.tag = "out of line";

const receivers = [
  { tag: "own" }, { other: 1, tag: "second slot" }, { other: 1 }, {}, new Plain("made"), new Heir("heir"), Object.create({ tag: "inherited" }),
  Object.create(null), many, [1, 2], Object.assign([], { tag: "array" }), function () {}, Object.assign(() => 0, { tag: "function" }),
  new Proxy({}, { get: () => "trapped" }), 1, 1.5, NaN, true, false, "text", "", Symbol("s"), 10n, null, undefined,
];

function round(order) {
  const answers = [];
  for (const index of order) answers.push(describe(receivers[index]));
  return answers.join(" | ");
}

const inTurn = receivers.map((_, index) => index);
console.log(round(inTurn));
console.log(round(inTurn.slice().reverse()));

// The same receiver many times, so that the site settles on it, and then each of the others once.
for (const settled of inTurn) {
  let last = "";
  for (let i = 0; i < 300; i++) last = describe(receivers[settled]);
  console.log(last + " : " + round(inTurn));
}

delete Number.prototype.tag;
receivers[0].tag = "stored again";
delete receivers[1].tag;
console.log(round(inTurn));
