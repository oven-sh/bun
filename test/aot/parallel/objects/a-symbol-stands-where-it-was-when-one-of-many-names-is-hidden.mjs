const sign = Symbol("sign");
function many(count, prefix) {
  const object = {};
  for (let i = 0; i < count; i++) object[prefix + i] = i;
  return object;
}
function withSymbol(count, prefix) {
  const object = many(count >> 1, prefix);
  object[sign] = 2;
  for (let i = count >> 1; i < count; i++) object[prefix + i] = i;
  return object;
}
function make(front, behind, value) {
  return { ...front, s0: value, __proto__: null, s1: value, s2: value, ...behind };
}
function show(total, front) {
  const object = make(withSymbol(front, "a"), many(Math.max(0, total - front - 3), "b"), total);
  object.more = 1;
  object.yet = 2;
  Object.defineProperty(object, "a0", { value: 5, enumerable: false, configurable: true, writable: true });
  const printed = Bun.inspect(object).replace(/\s+/g, " ");
  const names = printed.slice(0, printed.indexOf("[Symbol(sign)]")).split(",").length - 1;
  console.log(total, front, "symbol behind", names, Object.keys(object).length, JSON.stringify(object).length, Reflect.ownKeys(object).findIndex(key => key === sign));
}
for (let turn = 0; turn < 2; turn++) {
  for (const total of [123, 126, 127, 128, 129, 130, 131, 132, 134]) {
    for (const front of [2, total >> 1, total]) show(total, front);
  }
}
