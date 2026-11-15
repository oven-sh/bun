// More fields than an empty object has room for in line, and a target that already holds some.
const proto = { kind: "p" };
function wide(count, round) {
  const source = {};
  for (let index = 0; index < count; index++) source["field" + index] = index + round;
  return source;
}
const literal = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14 };
for (let round = 0; round < 5; round++) {
  console.log(JSON.stringify(Object.assign(Object.create(proto), literal)));
  for (const count of [0, 1, 6, 7, 20, 70]) {
    const made = Object.assign(Object.create(proto), wide(count, round));
    console.log(count, Object.keys(made).length, made["field" + (count - 1)], JSON.stringify(made).length);
  }
  const partly = Object.create(proto);
  partly.z = 0;
  partly.c = -3;
  console.log(JSON.stringify(Object.assign(partly, literal, { z: 26, extra: true })));
}
