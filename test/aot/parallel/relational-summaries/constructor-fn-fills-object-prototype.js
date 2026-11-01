// `this.pos = pos` in a constructor function stores into an object that has no `pos` yet, so the store asks the prototype object of the function and whatever lies above it. Anybody who has the function
// reaches that object, before the first construction or between two. "The object is fresh and holds the argument in its field" holds only while nothing up there takes or refuses the store.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
function takes(value) {
  kept.push(value);
}
const spy = {
  set pos(value) {
    kept.push(value);
  },
  get pos() {
    kept.push({ tag: 9, list: [this.end] });
    return "read";
  },
  set extra(value) {
    kept.push(value);
  },
  get extra() {
    kept.push({ tag: 7, list: [this.end] });
    return "got";
  },
};
function Plain(pos, end) {
  this.pos = pos;
  this.end = end;
}
function Defined(pos, end) {
  this.pos = pos;
  this.end = end;
}
function DefinedByMap(pos, end) {
  this.pos = pos;
  this.end = end;
}
function DefinedTheOldWay(pos, end) {
  this.pos = pos;
  this.end = end;
}
function DefinedByReflect(pos, end) {
  this.pos = pos;
  this.end = end;
}
function Relinked(pos, end) {
  this.pos = pos;
  this.end = end;
}
function Reassigned(pos, end) {
  this.pos = pos;
  this.end = end;
}
function Keyed(pos, end) {
  this.pos = pos;
  this.end = end;
}
function Linked(pos, end) {
  this.pos = pos;
  this.end = end;
}
function Default(pos, end) {
  this.pos = pos;
  this.end = end;
}
function Iced(pos, end) {
  this.pos = pos;
  this.end = end;
}
function OnItsOwnPrototype(pos, end) {
  this.pos = pos;
  this.end = end;
}
function DefinedToo(pos, end) {
  this.pos = pos;
  this.end = end;
}
function ReassignedByKey(pos, end) {
  this.pos = pos;
  this.end = end;
}
function define(target) {
  Object.defineProperty(target, "pos", { set: takes, configurable: true });
  Object.defineProperty(target, "extra", { set: takes, configurable: true });
}
// A name that no constructor fills, stored and read by somebody who was handed the object.
function writesExtra(o, value) {
  o.extra = value;
}
function readsExtra(o) {
  return o.extra;
}
function storeUnder(target, key, value) {
  target[key] = value;
}
const attacks = [
  () => {},
  () => {
    define(Defined.prototype);
    define(DefinedToo.prototype);
    define({});
  },
  () => Object.defineProperties(DefinedByMap.prototype, { pos: { set: takes }, other: { value: 1 } }),
  () => DefinedTheOldWay.prototype.__defineSetter__("pos", takes),
  () => Reflect.defineProperty(DefinedByReflect.prototype, "pos", { set: takes }),
  () => Object.setPrototypeOf(Relinked.prototype, spy),
  () => {
    Reassigned.prototype = spy;
  },
  () => storeUnder(Keyed.prototype, ["__pro", "to__"].join(""), spy),
  () => {
    Linked.prototype.__proto__ = spy;
  },
  () => {
    Default.prototype.pos = -1;
  },
  () => {
    Iced.prototype.pos = -1;
    Object.freeze(Iced.prototype);
  },
  () => OnItsOwnPrototype.call(OnItsOwnPrototype.prototype, { tag: -5, list: [-5] }, 0),
  () => storeUnder(ReassignedByKey, ["proto", "type"].join(""), spy),
];
const makers = [
  (o, end) => new Plain(o, end),
  (o, end) => new Defined(o, end),
  (o, end) => new DefinedByMap(o, end),
  (o, end) => new DefinedTheOldWay(o, end),
  (o, end) => new DefinedByReflect(o, end),
  (o, end) => new Relinked(o, end),
  (o, end) => new Reassigned(o, end),
  (o, end) => new Keyed(o, end),
  (o, end) => new Linked(o, end),
  (o, end) => new Default(o, end),
  (o, end) => new Iced(o, end),
  (o, end) => new OnItsOwnPrototype(o, end),
  (o, end) => new DefinedToo(o, end),
  (o, end) => new ReassignedByKey(o, end),
];
function describe(made) {
  const own = Object.hasOwn(made, "pos");
  const pos = made.pos;
  return (own ? "own " : "none ") + (pos && typeof pos === "object" ? pos.tag + pos.list[0] : String(pos)) + " " + made.end;
}
function round(first) {
  const lines = [];
  for (let way = 0; way < makers.length; way++) {
    let line = "";
    for (let turn = 0; turn < 20; turn++) {
      const tag = first + way * 100 + turn;
      try {
        const made = makers[way]({ tag, list: [tag] }, turn);
        writesExtra(made, { tag: tag + 1, list: [tag] });
        const extra = readsExtra(made);
        if (turn === 19) line = describe(made) + " " + (Object.hasOwn(made, "extra") ? "own " : "none ") + (extra && typeof extra === "object" ? extra.tag : String(extra));
      } catch (error) {
        line = error.constructor.name;
      }
    }
    lines.push(line);
  }
  churn(30);
  return lines.join(" | ");
}
console.log(round(0));
console.log(kept.length);
for (const attack of attacks) attack();
console.log(round(10000));
churn(40);
let sum = 0;
for (const value of kept) sum += value.tag + value.list[0];
console.log(kept.length, sum);
console.log(describe(OnItsOwnPrototype.prototype), describe(Object.create(OnItsOwnPrototype.prototype)));
