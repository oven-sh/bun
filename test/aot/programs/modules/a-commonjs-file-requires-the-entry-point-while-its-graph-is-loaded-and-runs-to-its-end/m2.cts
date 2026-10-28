const show = (value: unknown): string =>
  value === null
    ? "null"
    : typeof value === "object" || typeof value === "function"
      ? typeof value +
        "{" +
        Reflect.ownKeys(value)
          .filter(
            key =>
              typeof key === "string" &&
              !["length", "name", "prototype", "arguments", "caller", "__esModule"].includes(key),
          )
          .join() +
        "}"
      : typeof value + ":" + String(value);
const tell = (label: string, read: () => unknown) => {
  let shown;
  try {
    shown = show(read());
  } catch (error) {
    shown = "throws " + (error as Error)?.name;
  }
  console.log(label, shown);
};
const atTheEnd = ((globalThis as any).atTheEnd ??= []) as (() => unknown)[];

console.log("m2 begins");
exports.first = function first() {
  return "m2";
};
module.exports.second = 2;
{
  const begun = (async () => {
    try {
      const m3_0 = await import("./m3.cjs");
      tell("m2 not awaited m3", () => m3_0);
      tell("m2 not awaited m3.second", () => (m3_0 as any).second);
      tell("m2 not awaited m3.default", () => (m3_0 as any).default);
    } catch (error) {
      console.log("m2 not awaited m3 throws", (error as Error)?.name);
    }
  })();
  atTheEnd.unshift(() => begun);
}
console.log("m2 ends");
