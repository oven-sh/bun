// The constructor of a class makes an object for somebody else: a new target out of Reflect.construct, a class out of run-time text, a bound function, a Proxy. The constructor keeps `this`, and typed-looking code calls its members later. The order of the births is walked through.
const lines = [];
const say = text => { lines.push(text); };
const kept = [];
class Base {
  constructor(x) {
    this.x = x;
    this.y = 2;
    kept.push(this);
    this.seenAtBirth = this.name();
  }
  name() { return "base"; }
  get twice() { return this.x * 2; }
  sum() { return this.x + this.y; }
}
class Below extends Base {
  constructor(x) {
    super(x);
    this.z = 3;
  }
  name() { return "below"; }
  sum() { return super.sum() + this.z; }
}
function lookAll(label) {
  let text = "";
  for (let i = 0; i < kept.length; i++) {
    const o = kept[i];
    let one;
    try {
      one = o.name() + "," + o.twice + "," + o.sum() + "," + o.seenAtBirth + "," + (o instanceof Base) + "," + ("extra" in o) + "," + o.extra;
    } catch (error) {
      one = "threw " + error.name;
    }
    text += one + " | ";
  }
  say(label + ": " + text);
}
function Other() {}
Other.prototype.name = function () { return "other"; };
Other.prototype.sum = function () { return "other sum"; };
Other.prototype.extra = "extra of other";
Object.defineProperty(Other.prototype, "x", { get() { return "x above"; }, set(v) { say("setter above got " + v); }, configurable: true });
const births = [
  () => new Base(1),
  () => new Below(1),
  () => Reflect.construct(Base, [1], Other),
  () => Reflect.construct(Below, [1], Other),
  () => Reflect.construct(Base, [1], Below),
  () => new ((0, eval)("(B => class Text extends B { name() { return 'text'; } get twice() { return 'twice of text'; } })"))(Base)(1),
  () => new (Base.bind(null, 1))(),
  () => new (new Proxy(Below, { get(target, key, receiver) { return key === "prototype" ? Other.prototype : Reflect.get(target, key, receiver); } }))(1),
  () => Reflect.construct(Base, [1], Object.assign(function () {}, { prototype: null })),
  () => Reflect.construct(Base, [1], Array),
  () => Reflect.construct(Base, [1], new Proxy(function () {}, { get(target, key) { return key === "prototype" ? new Proxy({}, { get(t, k) { return typeof k === "string" && k !== "then" ? () => "trapped " + k : undefined; }, has() { return true; } }) : target[key]; } })),
];
for (let a = 0; a < births.length; a++) {
  for (let b = 0; b < births.length; b++) {
    kept.length = 0;
    for (const index of [a, b, a]) {
      try {
        births[index]();
      } catch (error) {
        say(index + " threw " + error.name);
      }
    }
    lookAll(a + "," + b);
  }
}
console.log(lines.join("\n"));
