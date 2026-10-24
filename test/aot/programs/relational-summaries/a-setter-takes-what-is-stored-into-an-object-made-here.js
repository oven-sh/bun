// A function makes an object, stores its argument into it and drops the object. "The argument lives in an object that nobody keeps, so nobody keeps the argument" holds only if the store was a plain
// store. A setter of the class, of the literal or of a prototype has the argument, and a getter has the object and all that lies in it.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
class Box {
  set x(value) {
    kept.push(value);
  }
}
class Plain {
  constructor() {
    this.x = null;
  }
}
class Heir extends Box {}
class Looks {
  constructor(inner) {
    this.inner = inner;
  }
  get all() {
    kept.push(this);
    return 1;
  }
}
function intoBox(o) {
  const b = new Box();
  b.x = o;
}
function intoPlain(o) {
  const b = new Plain();
  b.x = o;
}
function intoHeir(o) {
  const b = new Heir();
  b.x = o;
}
function intoLiteral(o) {
  const b = {
    set x(value) {
      kept.push(value);
    },
  };
  b.x = o;
}
const above = {
  set x(value) {
    kept.push(value);
  },
};
function intoChild(o) {
  const b = Object.create(above);
  b.x = o;
}
function intoLiteralBelow(o) {
  const b = { __proto__: above };
  b.x = o;
}
function throughGetter(o) {
  const b = new Looks(o);
  return b.all;
}
function throughLiteralGetter(o) {
  const b = {
    inner: o,
    get all() {
      kept.push(this);
      return 1;
    },
  };
  return b.all;
}
function make(tag) {
  return { tag, list: [tag, tag + 1], deep: { tag: tag * 2 } };
}
const ways = [intoBox, intoPlain, intoHeir, intoLiteral, intoChild, intoLiteralBelow, throughGetter, throughLiteralGetter];
for (let round = 0; round < 40; round++) {
  for (let way = 0; way < ways.length; way++) ways[way](make(round * 10 + way));
  if (round % 8 === 0) churn(20);
}
churn(40);
let sum = 0;
for (const value of kept) {
  const o = value.inner ?? value;
  sum += o.tag + o.list[1] + o.deep.tag;
}
console.log(kept.length, sum);
console.log(JSON.stringify(kept[0]), JSON.stringify(kept[kept.length - 1]));
