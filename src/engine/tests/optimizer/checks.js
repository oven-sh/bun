// Checks that are done in another place, or by another check.

const things = () => [
  [{ x: 1 }], [{ x: 2, y: 3 }], [{ y: 3, x: 4 }], [null], [undefined], [""], ["text"], [0], [5], [false], [true], [0n],
  [[]], [Symbol.iterator], [() => 1],
];

check(function (a) {
  function method() {
    const kind = typeof this;
    return [kind, this.x];
  }
  return method.call(a);
}, things);

check(function (a) {
  const seen = [];
  function method() {
    seen[0] = typeof this;
    return this.x;
  }
  return [method.call({ x: 1 }), method.call({ y: 1, x: 2 }), method.call(a), seen];
}, things);

check(function (a) {
  function method(other) {
    other.z = 1;
    return this.x;
  }
  const o = { x: 1 };
  return [method.call(o, {}), method.call(a ?? o, a ?? o)];
}, things);

check(a => (a == null ? "nothing" : a.x), things);
check(a => (a != null ? a.x : "nothing"), things);
check(a => (a ? a.x : "falsy"), things);
check(a => (!a ? "falsy" : "truthy"), things);
check(a => [a || 1, a && 2, a ?? 3], things);

check(function (a) {
  const isNothing = a == null;
  if (isNothing) return [isNothing, 1];
  return [isNothing, 2];
}, things);

check(function (end) {
  let node = { next: { next: { next: end } } }, count = 0;
  while (node != null && count < 5) (node = node.next), count++;
  return count;
}, things);

check(function (end) {
  let node = { next: { next: { next: end } } }, count = 0;
  do count++;
  while ((node = node.next));
  return [count, node];
}, things);

check(function (a) {
  let result = 0;
  if (a) result = 1;
  if (a == null) result += 2;
  return result;
}, things);

check(
  function (a, b, i) {
    let sum = a[i] === undefined ? 0 : 1;
    for (let turn = 0; turn < 3; turn++) sum += b[i] === undefined ? 0 : b[i];
    return sum;
  },
  () => [[[1, 2, 3], [1], 2], [[1], [1, 2, 3], 2], [[1, 2, 3], [4, 5, 6], 1], [new Array(100).fill(1), [], 99]],
);

check(function (a, b) {
  const list = [0.5, a];
  return ((list[0] * b) | 0) + ((list[0] * b) >>> 3) + ((a * b) | 0);
}, pairs);

const withName = (made, ...names) => (names.forEach(name => (made[name] = 1)), made);
check(
  function (a, b, c) {
    const measure = o => o.length + o.x;
    return [measure(a), measure(b), measure(c)];
  },
  () => [[1, 2], { x: 1 }, "text", new Uint8Array(2)].map(it => [withName([1], "x"), withName([1], "y", "x"), Array.isArray(it) ? withName(it, "x") : it]),
);
