function frozen() { return Object.freeze([1, 2, 3]); }
function withReadOnlyLength() { return Object.defineProperty([1.5, 2.5, 3.5], "length", { writable: false }); }
function cut(list) {
  list.length = 1;
  return list.length;
}
function cutsOwnLiteral() {
  var list = [1, 2, 3];
  Object.freeze(list);
  list.length = 1;
  return list.length;
}
function setsInvalidLength() {
  var list = [1, 2, 3];
  list.length = -1;
  return list.length;
}
class Strict {
  static cut(list) {
    list.length = 1;
    return list.length;
  }
  static cutsOwnLiteral() {
    const list = [1, 2, 3];
    Object.freeze(list);
    list.length = 1;
    return list.length;
  }
  static setsInvalidLength() {
    const list = [1, 2, 3];
    list.length = -1;
    return list.length;
  }
  static callsSloppy(list) { return cut(list); }
}
function callsStrict(list) { return Strict.cut(list); }
exports.cut = cut;
exports.rows = function (cutTyped) {
  function callsTypeScript(list) { return cutTyped(list); }
  return {
    "sloppy, writable": () => cut([1, 2, 3]),
    "sloppy, frozen": () => cut(frozen()),
    "sloppy, read-only length": () => cut(withReadOnlyLength()),
    "sloppy, its own frozen literal": () => cutsOwnLiteral(),
    "sloppy, invalid length": () => setsInvalidLength(),
    "strict, writable": () => Strict.cut([1, 2, 3]),
    "strict, frozen": () => Strict.cut(frozen()),
    "strict, read-only length": () => Strict.cut(withReadOnlyLength()),
    "strict, its own frozen literal": () => Strict.cutsOwnLiteral(),
    "strict, invalid length": () => Strict.setsInvalidLength(),
    "sloppy calls strict, writable": () => callsStrict([1, 2, 3]),
    "sloppy calls strict, frozen": () => callsStrict(frozen()),
    "sloppy calls strict, read-only length": () => callsStrict(withReadOnlyLength()),
    "strict calls sloppy, writable": () => Strict.callsSloppy([1, 2, 3]),
    "strict calls sloppy, frozen": () => Strict.callsSloppy(frozen()),
    "strict calls sloppy, read-only length": () => Strict.callsSloppy(withReadOnlyLength()),
    "sloppy calls TypeScript, writable": () => callsTypeScript([1, 2, 3]),
    "sloppy calls TypeScript, frozen": () => callsTypeScript(frozen()),
    "sloppy calls TypeScript, read-only length": () => callsTypeScript(withReadOnlyLength()),
  };
};
