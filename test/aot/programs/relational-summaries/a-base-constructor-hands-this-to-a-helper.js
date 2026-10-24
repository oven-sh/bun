// While the constructor of the base class runs, the fields of the heir do not exist yet: a helper that is handed `this` there and stores under the name of such a field meets whatever the chain has under that name: the setter of the class in between. Afterwards the field is defined over it. "This field is always filled" is true of every read and says nothing about that store.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const keptBySetter = [];
const unfinished = [];
function fill(o, v) {
  o.value = v;
}
function fillAndRead(o, v) {
  o.value = v;
  return o.value;
}
function fillByKey(o, key, v) {
  o[key] = v;
}
function look(o) {
  return "value" in o ? typeof o.value : "nothing";
}
class Base {
  constructor(v) {
    this.early = look(this);
    fill(this, v);
    this.answer = fillAndRead(this, { tag: v.tag + ", second" });
    fillByKey(this, "value", { tag: v.tag + ", by key" });
    this.own = Object.hasOwn(this, "value");
  }
}
class Between extends Base {
  set value(v) {
    if (v.tag.endsWith("99") || v.tag.includes("99,")) {
      keptBySetter.push(v);
      unfinished.push(this);
    }
  }
  get value() {
    return "from the getter";
  }
}
class Heir extends Between {
  value = { tag: "the field" };
  after = 1;
}
class HeirWithoutSetter extends Base {
  value = { tag: "the field" };
}
class HeirOfAFrozenThis extends Base {
  constructor(v) {
    super(v);
    Object.freeze(this);
  }
}
let line = "";
for (let i = 0; i < 400; i++) {
  const h = new Heir({ tag: "handed " + i });
  const plain = new HeirWithoutSetter({ tag: "plain " + i });
  const frozen = new HeirOfAFrozenThis({ tag: "frozen " + i });
  line = [h.early, h.answer, h.own, h.value.tag, h.after, plain.early, plain.answer.tag, plain.own, plain.value.tag, frozen.value.tag].join(" | ");
}
console.log(line);
console.log(churn(60), keptBySetter.map(v => v.tag).join(" | "));
console.log(unfinished.map(o => o.value.tag + " " + o.after + " " + o.own).join(" | "), new Set(unfinished).size);

// The same with a helper that is a method of the base, a callback, and Reflect.set with another receiver.
class Base2 {
  constructor(v, how) {
    how(this, v);
  }
  put(v) {
    this.slot = v;
  }
}
const seenBySlot = [];
class Between2 extends Base2 {
  set slot(v) {
    seenBySlot.push(v.tag);
  }
}
class Heir2 extends Between2 {
  slot = null;
}
const hows = [
  (o, v) => o.put(v),
  (o, v) => Base2.prototype.put.call(o, v),
  (o, v) => Reflect.set(o, "slot", v),
  (o, v) => Reflect.set({}, "slot", v, o),
  (o, v) => Object.assign(o, { slot: v }),
  (o, v) => ({ slot: o.slot } = { slot: v }),
  (o, v) => [o.slot] = [v],
  (o, v) => Object.defineProperty(o, "slot", { value: v, writable: true, configurable: true, enumerable: true }),
];
const made = hows.map((how, i) => new Heir2({ tag: "way " + i }, how));
console.log(seenBySlot.join(), made.map(o => String(o.slot)).join());
