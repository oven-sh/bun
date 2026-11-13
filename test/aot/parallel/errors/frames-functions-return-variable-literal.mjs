// Prints the frames of errors thrown below functions that declare a variable and return it right behind, where a literal chooses the variable among
// the operands of the returned expression. Bun's transpiler prints the chosen operand alone, and the initializer of the variable in its place.
const listFrames = error =>
  error.stack
    .split("\n")
    .slice(1, 4)
    .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
    .join(" | ");
function thrower() {
  throw new RangeError("thrown");
}
function other() {
  return "other";
}
function show(f) {
  try {
    f(1);
    console.log(f.name, "did not throw");
  } catch (error) {
    console.log(f.name, "|", listFrames(error));
  }
}
show(function firstArm(n) {
  const result = thrower(n);
  return 591 ? result : other();
});
show(function secondArm(n) {
  const result = thrower(n);
  return 0 ? other() : result;
});
show(function armOfText(n) {
  const result = thrower(n);
  return "a" ? result : other();
});
show(function armOfEmptyText(n) {
  const result = thrower(n);
  return "" ? other() : result;
});
show(function armOfNull(n) {
  const result = thrower(n);
  return null ? other() : result;
});
show(function armOfNegation(n) {
  const result = thrower(n);
  return !0 ? result : other();
});
show(function armOfConstant(n) {
  const chooses = 1;
  const result = thrower(n);
  return chooses ? result : other();
});
show(function armInsideArm(n) {
  const result = thrower(n);
  return 1 ? (0 ? other() : result) : other();
});
show(function behindAnd(n) {
  const result = thrower(n);
  return 1 && result;
});
show(function behindOr(n) {
  const result = thrower(n);
  return 0 || result;
});
show(function behindNullish(n) {
  const result = thrower(n);
  return null ?? result;
});
show(function behindDroppedOperand(n) {
  const result = thrower(n);
  return (n, result);
});
show(function behindOperandThatRuns(n) {
  const result = thrower(n);
  return (other(), result);
});
show(function armThatParameterChooses(n) {
  const result = thrower(n);
  return n ? result : other();
});
show(function throughVariableThatLiteralChooses(n) {
  const first = thrower(n);
  const second = 1 ? first : other();
  return second;
});
show(function armIsTheCall(n) {
  return 591 ? thrower(n) : other();
});
show(function armIsMethodCall(n) {
  const holder = { thrower };
  return (1 ? holder.thrower : other)(n);
});
show(function constantThatLiteralChooses(n) {
  const chosen = 1 ? 2 : 3;
  const result = thrower(n + chosen);
  return result;
});
