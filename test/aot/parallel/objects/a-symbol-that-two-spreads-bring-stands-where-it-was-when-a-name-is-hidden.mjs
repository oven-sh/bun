const sign = Symbol("sign");
function many(count, prefix) {
  const object = {};
  for (let i = 0; i < count; i++) object[prefix + i] = i;
  return object;
}
function symbolAtEnd(count, prefix) {
  const object = many(count, prefix);
  object[sign] = 2;
  return object;
}
function show(total, front) {
  const behind = Math.max(0, total - front - 4);
  const object = Object.setPrototypeOf({ ...symbolAtEnd(front, "a"), s0: "t", s1: 0.5, s2: total, s3: 0.5, ...symbolAtEnd(behind, "a") }, null);
  Object.defineProperty(object, "a0", { value: 5, enumerable: false, configurable: true, writable: true });
  const printed = Bun.inspect(object).replace(/\s+/g, " ");
  const names = printed.slice(0, printed.indexOf("[Symbol(sign)]")).split(",").length - 1;
  console.log(total, front, "symbol behind", names, Object.keys(object).length, JSON.stringify(object).length);
}
for (let turn = 0; turn < 2; turn++) {
  for (const total of [122, 124, 126, 128, 130, 134, 135]) {
    for (const front of [0, 1, 3, total >> 1]) show(total, front);
  }
}
