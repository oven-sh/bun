// `for (name in source) target[name] = name === "inner" ? {} : source[name]` over six written names: each turn of the loop gets a copy for its name, where both accesses go to a slot.
// COUNT: operation:operationAOTCreateField = 0
// COUNT: arrivals <= 40
function turn(i) {
  var source = { kind: "method", name: "m", isStatic: false, isPrivate: false, inner: { has: object => "m" in object, get: object => object.m }, data: undefined };
  var target = {};
  for (var name in source) target[name] = name === "inner" ? {} : source[name];
  for (var name in source.inner) target.inner[name] = source.inner[name];
  return target.name.length + target.kind.length + (target.isStatic ? 1 : 0) + (target.inner.has({ m: i }) ? target.inner.get({ m: i }) : -1);
}
let sum = 0;
for (let i = 0; i < 1000; i++) sum += turn(i & 7);
console.log(sum);
