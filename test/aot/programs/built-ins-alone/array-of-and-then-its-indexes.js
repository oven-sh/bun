const held = Array.of(1.5, "an");
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (let index = 0; index < held.length; index++) console.log(show(held[index]));
