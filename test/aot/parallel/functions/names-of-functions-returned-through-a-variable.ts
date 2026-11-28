// A function that only passes through variables on its way to a `return` has no name where Bun's transpiler prints it in the `return`.
function between() {}
function namedOnce() {
  const made = () => {};
  return made;
}
function declaredWithLet() {
  let made = function () {};
  return made;
}
function declaredWithVar() {
  var made = () => {};
  return made;
}
function aClass() {
  const made = class {};
  return made;
}
function annotated() {
  const made: () => void = () => {};
  return made as Function;
}
function throughAnotherConstant() {
  const made = () => {};
  const second = made;
  return second;
}
function inOneStatement() {
  const made = () => {},
    second = made;
  return second;
}
function notTheLast(n: number) {
  const made = () => {},
    other = n;
  return made;
}
function typesBetween() {
  const made = () => {};
  interface Unused {}
  type Made = typeof made;
  return made;
}
function statementBetween() {
  const made = () => {};
  between();
  return made;
}
function namedTwice() {
  const made = () => {};
  made();
  return made;
}
function breakBehind(n: number) {
  switch (n) {
    default:
      const made = () => {};
      return made;
      break;
  }
}
function beforeUnreachableStatement() {
  const made = () => {};
  return made;
  return made;
}
function insideTry() {
  try {
    const made = () => {};
    return made;
  } catch {
    return between;
  }
}
for (const make of [
  namedOnce,
  declaredWithLet,
  declaredWithVar,
  aClass,
  annotated,
  throughAnotherConstant,
  inOneStatement,
  notTheLast,
  typesBetween,
  statementBetween,
  namedTwice,
  breakBehind,
  beforeUnreachableStatement,
  insideTry,
]) {
  console.log(make.name, JSON.stringify(make(1).name));
}
