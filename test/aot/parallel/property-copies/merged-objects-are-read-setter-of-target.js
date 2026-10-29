// Merged objects are read a setter of the target.
function productsOf(merged) {
  let sum = 0;
  for (let turn = 0; turn < 100; turn++) sum = (sum + merged.a * merged.b - merged.c) | 0;
  return sum;
}
function sumsOf(merged) {
  let sum = 0;
  for (let turn = 0; turn < 100; turn++) sum += merged.a + merged.b + merged.c;
  return sum;
}
function show(label, merged) {
  console.log(label, productsOf(merged), sumsOf(merged), merged.a, merged.b, merged.c, "a" in merged, "b" in merged, "c" in merged);
}
function list(label, merged) {
  console.log(label, Object.keys(merged).join(), JSON.stringify(merged), Reflect.ownKeys(merged).map(String).join());
}
const heard = [];
const defaults = { a: 1, b: 2 };
function spread(options) { return { set c(value) { heard.push(value); }, ...defaults, ...options }; }
function assign(options) { return Object.assign({ set c(value) { heard.push(value); } }, defaults, options); }
show("spread", spread({ c: 3 }));
show("assigned", assign({ c: 3 }));
console.log(heard.join());
