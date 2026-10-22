const held = JSON.rawJSON("1.5");
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (const key in held) console.log(key, show(held[key]));
