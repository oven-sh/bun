// Each function declares a constant whose initializer reads the constant itself.
function show(f) {
  try {
    console.log(f.name, f());
  } catch (error) {
    console.log(f.name, error.name);
  }
}
show(function itself() {
  const a = a;
  return a;
});
show(function negated() {
  const a = -a;
  return a;
});
show(function inverted() {
  const a = !a;
  return a ? 1 : 2;
});
show(function chooses() {
  const a = a ? 1 : 2;
  return a;
});
show(function typeOfItself() {
  const a = typeof a;
  return a;
});
show(function inSum() {
  const a = 1 + a;
  return a;
});
show(function behindLiteral() {
  const a = 1 && a;
  return a;
});
show(function notReached() {
  const a = 0 && a;
  return a;
});
show(function armNotChosen() {
  const a = 1 ? 2 : a;
  return a;
});
show(function inClosure() {
  const a = () => a;
  return typeof a();
});
show(function inClosureCalledAtOnce() {
  const a = (() => a)();
  return a;
});
show(function two() {
  const a = b;
  const b = a;
  return b;
});
