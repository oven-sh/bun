const sign = Symbol("sign");
const empty = Object.create(null);
function many(count, prefix) {
  const object = {};
  for (let i = 0; i < count; i++) object[prefix + i] = i;
  return object;
}
function make(front, behind) {
  return { __proto__: empty, own: 1, ...front, late: 2, ...behind };
}
function show(count, behind) {
  const object = make({ [sign]: 1, ...many(count, "a") }, Object.fromEntries(Object.entries(many(behind, "a")).reverse()));
  Object.defineProperty(object, "a2", { writable: false });
  const printed = Bun.inspect(object).replace(/\s+/g, " ");
  const names = printed.slice(0, printed.indexOf("[Symbol(sign)]")).split(",").length - 1;
  console.log(count, behind, "symbol behind", names, Object.keys(object).length, JSON.stringify(object).length);
}
for (const count of [1, 15, 100, 128, 131, 255, 256, 257]) {
  for (const behind of [6, 16, 128, 131]) show(count, behind);
}
