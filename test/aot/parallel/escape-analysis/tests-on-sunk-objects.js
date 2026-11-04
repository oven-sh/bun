// Tests of objects, lists and argument lists that are never made: each test is replaced by a value, and its branch hands on what it proved.
function third() {
  return arguments.length > 2 ? arguments[2] : arguments[0];
}
function restAt(position, ...rest) {
  const found = rest[position];
  return found === undefined ? -1 : found;
}
function shape(flag, value) {
  const made = flag ? { kind: "a", value } : { kind: "b", value, more: 1 };
  if (made.kind === "a") return made.value + 1;
  return "more" in made ? made.value + made.more : 0;
}
function maybe(flag) {
  const made = flag ? { inner: { n: 1 } } : { inner: null };
  return made.inner ? made.inner.n : 0;
}
function first(text) {
  const parts = text.split(",", 2);
  return parts[1] === undefined ? parts[0] : parts[1];
}
function removed(value) {
  const made = { value, gone: 1 };
  const did = delete made.gone;
  return did && !("gone" in made) ? made.value : -1;
}
function typed(flag) {
  const made = flag ? [1, 2] : { length: 5 };
  return Array.isArray(made) ? made[1] : typeof made === "object" ? made.length : 0;
}
let sum = 0;
for (let turn = 0; turn < 500; turn++) {
  sum += third(turn, 1) + third(1, 2, turn) + restAt(turn & 3, 5, 6) + restAt(-1, 5) + shape(turn & 1, turn) + maybe(turn & 2);
  sum += first(turn & 1 ? "1,2,3" : "7").length + removed(turn) + typed(turn & 1);
}
console.log(sum);
