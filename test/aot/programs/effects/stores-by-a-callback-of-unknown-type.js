// A callback reaches a built-in through a value the compiler cannot type. What the callback stores is read again after the call.
let seen = "not yet";
let count = 0;
function replacer(key, value) { seen = "replacer ran"; count++; return value; }
function compare(a, b) { seen = "compare ran"; count++; return a - b; }
function visit(value) { seen = "visit ran " + value; count++; }
const box = { replacer, compare, visit };
const list = [replacer, compare, visit];

function mergedWithUnknown(o) {
  const callback = globalThis.other ? globalThis.other : replacer;
  const before = seen, countBefore = count;
  JSON.stringify(o, callback);
  return [before, seen, count - countBefore];
}
function readByUnknownKey(o, key) {
  const before = seen, countBefore = count;
  JSON.stringify(o, box[key]);
  return [before, seen, count - countBefore];
}
function readFromList(xs, index) {
  const before = seen, countBefore = count;
  xs.sort(list[index]);
  return [before, seen, count - countBefore];
}
function passedThroughUnknownCode(xs) {
  const callback = JSON.parse("[0]").map(() => visit)[0];
  const before = seen, countBefore = count;
  xs.forEach(callback);
  return [before, seen, count - countBefore];
}
function inSpreadList(o, key) {
  const args = [o, box[key]];
  const before = seen, countBefore = count;
  JSON.stringify(...args);
  return [before, seen, count - countBefore];
}
function byApply(o, key) {
  const before = seen, countBefore = count;
  JSON.stringify.apply(null, [o, box[key]]);
  return [before, seen, count - countBefore];
}
function forwarded() {
  const before = seen, countBefore = count;
  JSON.stringify.apply(null, arguments);
  return [before, seen, count - countBefore];
}
const key = JSON.parse('"replacer"');
for (const run of [
  () => mergedWithUnknown({ x: 1 }), () => readByUnknownKey({ x: 1 }, key), () => readFromList([3, 1, 2], JSON.parse("1")), () => passedThroughUnknownCode([7]),
  () => inSpreadList({ x: 1 }, key), () => byApply({ x: 1 }, key), () => forwarded({ x: 1 }, replacer),
]) {
  seen = "not yet";
  console.log(JSON.stringify(run()));
}
