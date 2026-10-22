const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const held = pattern.exec("an");
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (const value of held.map(value => value)) console.log(show(value));
