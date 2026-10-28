// @bun
// This file has the first line that `bun build --target=bun` writes. Each function throws or calls a function that throws. Each row prints the frames down to the one below `show`, with the folders taken out of their places.
const framesOf = error => {
  const frames = error.stack
    .split("\n")
    .filter(line => line.startsWith("    at "))
    .map(line => line.trim().replace(/(file:\/\/)?[^\s()]*[\\/]/, "$1"));
  return frames.slice(0, frames.findIndex(frame => frame.startsWith("at show ")) + 2).join(" | ");
};
function thrower(n) {
  throw new Error("thrown with " + n);
}
function show(label, run, ...rest) {
  try {
    const result = run(thrower, ...rest);
    console.log(label + ": returned", result);
  } catch (error) {
    console.log(label + ":", error.name, "|", framesOf(error));
  }
}
function call(thrower, n) {
  const result = thrower(n);
  return result;
}
function method(thrower, n) {
  const o = { thrower };
  const result = o.thrower(n);
  return result;
}
function methodOnTheNextLine(thrower, n) {
  const holderWithALongName = { holderWithAnotherLongName: { holderWithAThirdLongName: { thrower } } };
  const result = holderWithALongName.holderWithAnotherLongName.holderWithAThirdLongName
    .thrower(n)
    .toString()
    .toString();
  return result;
}
function construct(thrower, n) {
  const result = new thrower(n);
  return result;
}
function memberOfNull() {
  const o = null;
  return o.x.y;
}
function elementOfNull() {
  const o = null;
  return o[0];
}
function optionalCall(thrower, n) {
  const result = thrower?.(n);
  return result;
}
function nameThatIsMissing() {
  return missing;
}
function storeToAMemberOfNull() {
  const o = null;
  o.x = 1;
}
function loopOverANumber(thrower, n) {
  for (const a of n) {
  }
}
function listPattern(thrower, n) {
  const [a] = n;
}
for (const run of [
  call,
  method,
  methodOnTheNextLine,
  construct,
  memberOfNull,
  elementOfNull,
  optionalCall,
  nameThatIsMissing,
  storeToAMemberOfNull,
  loopOverANumber,
  listPattern,
]) {
  show(run.name, run, 1);
}
