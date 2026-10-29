// Prints the frames of errors thrown below functions that declare a variable, then only types, and return the variable.
const listFrames = (error: Error) =>
  error
    .stack!.split("\n")
    .slice(1, 4)
    .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
    .join(" | ");
function thrower(n: number): number {
  throw new RangeError("thrown " + n);
}
function show(f: (n: number) => unknown) {
  try {
    f(1);
    console.log(f.name, "did not throw");
  } catch (error) {
    console.log(f.name, "|", listFrames(error as Error));
  }
}
show(function typeAliasBetween(n) {
  const result = thrower(n);
  type Result = typeof result;
  return result;
});
show(function interfaceBetween(n) {
  const result = thrower(n);
  interface Unused {}
  return result;
});
show(function typesBetweenConstants(n) {
  const first = thrower(n);
  type First = typeof first;
  const second = first;
  type Second = typeof second;
  return second;
});
show(function annotatedByTheAlias(n) {
  type Result = number;
  const result: Result = thrower(n);
  interface Unused {}
  return result;
});
show(function functionBetween(n) {
  const result = thrower(n);
  function unused() {}
  return result;
});
show(function callBetween(n) {
  const result = thrower(n);
  show.name;
  Math.abs(n);
  return result;
});
