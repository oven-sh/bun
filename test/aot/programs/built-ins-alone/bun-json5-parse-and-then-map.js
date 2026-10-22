const first = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const held = Bun.JSON5.parse(first);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (const value of held.map(value => value)) console.log(show(value));
