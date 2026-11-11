var held;
function same(x) { return x; }
class Reader {
  static seen;
  static { Reader.seen = typeof held; }
  static again() { return held.length; }
}
held = same("stored");
console.log(Reader.seen, Reader.again());
