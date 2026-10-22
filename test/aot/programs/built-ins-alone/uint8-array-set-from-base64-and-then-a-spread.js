const subject = new Uint8Array([1, 2, 3]);
const held = subject.setFromBase64("an");
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (const value of Object.values({ ...held })) console.log(show(value));
