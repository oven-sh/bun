function callback() {
  return { made: 1.5 };
}
const held = Map.groupBy("an", callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
held.forEach((value, key) => console.log(show(key), show(value)));
