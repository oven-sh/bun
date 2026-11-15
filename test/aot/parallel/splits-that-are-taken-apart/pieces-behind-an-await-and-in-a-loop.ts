// What is printed is what plain Bun prints.
const later = <T,>(value: T) => new Promise<T>(resolve => setTimeout(resolve, 0, value));
async function handle(path: string) {
  const parts = path.split("/");
  if (parts.length === 3 && parts[1] === "now") return "now " + parts[2];
  const waited = await later(parts.length);
  if (parts[1] === "shops") {
    const again = await later(parts[2]);
    return [waited, again, parts[2], parts[3], parts.length].join();
  }
  return "none " + parts[0] + waited;
}
function total(paths: string[]) {
  let sum = 0;
  for (const path of paths) { const parts = path.split("/"); sum += parts.length * 10 + (parts[1] === "a" ? 1 : 0); }
  return sum;
}
console.log("SAID " + (await Promise.all(["/now/1", "/shops/7/orders", "/x", ""].map(handle))).join(" ; ") + " " + total(["/a", "/b/c", "", "/a/a/a"]));
