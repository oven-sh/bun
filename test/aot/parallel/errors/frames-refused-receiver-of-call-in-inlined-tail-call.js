// `return f.call(..)` and `return f.apply(..)` where f finds the built-in and is not callable, in small functions that a loop calls under a try.
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(1, 4)
    .map(line => /^at (\S+) \(/.exec(line.trim())?.[1] ?? "module")
    .join(" < ");
function callWritten(f) {
  return f.call(null, 1, 2);
}
function callSpread(f, list) {
  return f.call(null, ...list);
}
function applyList(f, list) {
  return f.apply(null, list);
}
function applyWritten(f) {
  return f.apply(null, [1, 2]);
}
const fake = Object.create(Function.prototype);
function showCallWritten(f) {
  try {
    return callWritten(f);
  } catch (error) {
    return error.name + " " + frames(error);
  }
}
function showCallSpread(f) {
  try {
    return callSpread(f, [1, 2]);
  } catch (error) {
    return error.name + " " + frames(error);
  }
}
function showApplyList(f) {
  try {
    return applyList(f, [1, 2]);
  } catch (error) {
    return error.name + " " + frames(error);
  }
}
function showApplyWritten(f) {
  try {
    return applyWritten(f);
  } catch (error) {
    return error.name + " " + frames(error);
  }
}
for (const show of [showCallWritten, showCallSpread, showApplyList, showApplyWritten]) {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(show(fake));
  console.log(show.name, [...seen].join(" | "));
}
