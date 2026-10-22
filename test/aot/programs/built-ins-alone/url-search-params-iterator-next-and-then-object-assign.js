const subject = new URLSearchParams("first=1").entries();
const held = subject.next();
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
const copy = Object.assign({}, held);
for (const key in copy) console.log(key, show(copy[key]));
