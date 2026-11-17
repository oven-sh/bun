// The constructor of the base defines an accessor; another field of an heir alone is defined anew from outside.
const log = [];
function show(value) {
  return typeof value + String(value);
}
class Base {
  constructor(v) {
    this.a = v;
    Object.defineProperty(this, "b", {
      configurable: true,
      enumerable: true,
      get() {
        return this.a + 1;
      },
      set(x) {
        this.a = x * 2;
      },
    });
  }
  read() {
    return this.b;
  }
}
class Heir extends Base {
  get c() {
    return "above";
  }
}
class OtherHeir extends Base {
  constructor(v) {
    super(v);
    this.own = 1;
  }
}
function tell(name, one) {
  console.log(name, show(one.b), show(one.a), one.read(), Object.keys(one).join(), log.splice(0).join());
}
const before = new Base(1);
tell("before", before);
const heir = new Heir(2);
tell("heir", heir);
Object.defineProperty(heir, "a", {
  configurable: true,
  get() {
    return 47;
  },
  set(x) {
    log.push("set" + x);
  },
});
tell("heir", heir);
heir.b = 5;
tell("heir", heir);
const other = new OtherHeir(3);
Object.defineProperty(other, "own", { get: () => "accessor", configurable: true });
console.log(other.own, show(other.b), new OtherHeir(4).own);
tell("before", before);
let sum = 0;
for (const one of [new Base(5), new Heir(6), new OtherHeir(7), heir]) {
  for (let turn = 0; turn < 4; turn++) {
    one.b = turn;
    sum += one.b + one.a;
  }
}
console.log(sum, log.splice(0).join(), JSON.stringify(before));
