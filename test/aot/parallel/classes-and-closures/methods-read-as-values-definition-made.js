// Methods read as values that the definition made itself.
const lines = [];
const same = (label, ...values) => lines.push(label + " " + values.every(value => value === values[0]) + " " + typeof values[0]);
const own = (holder, key) => Object.getOwnPropertyDescriptor(holder, key).value;

// A member under an index comes first, so the definition makes every later member of that side itself.
class BehindAnIndex {
  0() { return "zero"; }
  plain() { return "plain"; }
  other() { return "other"; }
  static 1() { return "one"; }
  static fixed() { return "fixed"; }
}
const behind = new BehindAnIndex();
same("behind an index", behind.plain, behind.plain, BehindAnIndex.prototype.plain, own(BehindAnIndex.prototype, "plain"));
same("behind an index, other", behind.other, own(BehindAnIndex.prototype, "other"));
same("behind an index, static", BehindAnIndex.fixed, own(BehindAnIndex, "fixed"));
lines.push(behind.plain.call(null), behind.other.bind(behind)(), [1].map(behind.plain).join());

// A method that takes a variable of the function around the class comes first.
function around(seed) {
  class BehindACapture {
    taking() { return seed; }
    plain() { return "plain"; }
    get read() { return seed; }
    last() { return "last"; }
  }
  return BehindACapture;
}
const BehindACapture = around(3);
const captured = new BehindACapture();
same("behind a capture", captured.plain, BehindACapture.prototype.plain, own(BehindACapture.prototype, "plain"));
same("behind a capture, last", captured.last, own(BehindACapture.prototype, "last"));
same("the capturing one", captured.taking, own(BehindACapture.prototype, "taking"));

// The constructor takes a variable, the methods take none: the record makes them for this class object.
function withEnvironment(seed) {
  return class Counted {
    constructor() { this.seed = seed; }
    plain() { return "plain"; }
    twice() { return this.plain() + this.plain(); }
    static fixed() { return "fixed"; }
  };
}
const Counted = withEnvironment(5);
const counted = new Counted();
same("constructor takes a variable", counted.plain, Counted.prototype.plain, own(Counted.prototype, "plain"));
same("constructor takes a variable, static", Counted.fixed, own(Counted, "fixed"));
class Heir extends Counted {}
const heir = new Heir();
same("through an heir", heir.plain, counted.plain, own(Counted.prototype, "plain"));
same("through an heir, static", Heir.fixed, own(Counted, "fixed"));

// The value is read first and the holder is looked at afterwards, and the other way round.
class ReadFirst { 0() {} method() { return 1; } }
const first = new ReadFirst().method;
same("read first", first, own(ReadFirst.prototype, "method"), new ReadFirst().method);
class LookedAtFirst { 0() {} method() { return 1; } }
const looked = own(LookedAtFirst.prototype, "method");
same("looked at first", looked, new LookedAtFirst().method);

// Properties put on the function are seen through every way to it.
behind.plain.mark = "marked";
captured.plain.mark = "marked";
counted.plain.mark = "marked";
lines.push([own(BehindAnIndex.prototype, "plain").mark, own(BehindACapture.prototype, "plain").mark, own(Counted.prototype, "plain").mark, heir.plain.mark].join());

console.log(lines.join("\n"));
