// Text that is a constant and names one binding is compiled as a read of that binding: a name further in first, then a name of the file.
function early() {
  try {
    return eval("late");
  } catch (error) {
    return error.constructor === ReferenceError ? "ReferenceError" : "other";
  }
}
const before = early();
let late = JSON.parse('"late"');
let plain = JSON.parse('"file"');
export default function spelled() {
  return typeof eval("spelled");
}
function free() {
  return eval("plain");
}
function alsoFree() {
  return eval("plain");
}
function byParameter(plain) {
  return eval("plain");
}
function byBlock() {
  {
    const plain = "block";
    return eval("plain");
  }
}
function byCatch() {
  try {
    throw "caught";
  } catch (plain) {
    return eval("plain");
  }
}
const byOwnName = function plain() {
  return typeof eval("plain");
};
function byClass() {
  class plain {
    static where() {
      return typeof eval("plain");
    }
  }
  return plain.where();
}
function missing() {
  try {
    return eval("neverDeclared");
  } catch (error) {
    return error.constructor === ReferenceError ? "ReferenceError" : "other";
  }
}
console.log(
  before,
  early(),
  free(),
  alsoFree(),
  byParameter("parameter"),
  byBlock(),
  byCatch(),
  byOwnName(),
  byClass(),
);
plain = JSON.parse('"stored"');
console.log(free(), alsoFree(), byParameter("parameter"), spelled(), missing(), eval("plain"), eval("late"));
