const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const held = pattern[Symbol.split]("an", 2.5);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (const value of held) console.log(show(value));
