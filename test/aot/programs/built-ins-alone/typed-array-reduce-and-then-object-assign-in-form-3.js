const subject = new Uint8Array([1, 2, 3]);
function callback() {
  return { made: 1.5 };
}
const held = subject.reduce(callback, 2.5);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
const copy = Object.assign({}, held);
for (const key in copy) console.log(key, show(copy[key]));
