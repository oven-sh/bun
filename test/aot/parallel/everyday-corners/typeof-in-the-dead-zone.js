// Typeof in the dead zone: compiled answers as plain.
function f() {
  try {
    return typeof v;
  } catch (e) {
    return e.constructor.name;
  }
  let v;
}
console.log(f(), typeof neverDeclared);
