const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const held = "banana".match(first);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (let index = 0; index < held.length; index++) console.log(show(held[index]));
