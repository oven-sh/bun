// Merged objects are read an empty literal of the same type.
type Merged = { a?: number; b?: number; c?: number };
function productsOf(merged: Merged) {
  let sum = 0;
  for (let turn = 0; turn < 100; turn++) sum = (sum + merged.a! * merged.b! - merged.c!) | 0;
  return sum;
}
function sumsOf(merged: Merged) {
  let sum = 0;
  for (let turn = 0; turn < 100; turn++) sum += merged.a! + merged.b! + merged.c!;
  return sum;
}
function show(label: string, merged: Merged) {
  console.log(label, productsOf(merged), sumsOf(merged), merged.a, merged.b, merged.c, "a" in merged, "b" in merged, "c" in merged);
}
const defaults = { a: 1, b: 2 };
function spread(options: { c: number }): Merged { return { ...defaults, ...options }; }
function assign(options: { c: number }): Merged { return Object.assign({}, defaults, options); }
function leaveEmpty(): Merged { return {}; }
show("spread", spread({ c: 3 }));
show("assigned", assign({ c: 3 }));
show("empty", leaveEmpty());
