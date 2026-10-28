const show = value =>
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
const tell = (label, read) => {
  let shown;
  try {
    shown = show(read());
  } catch (error) {
    shown = "throws " + error?.name;
  }
  console.log(label, shown);
};
const atTheEnd = (globalThis.atTheEnd ??= []);

console.log("m3 begins");
require("./main.mjs");
Object.defineProperty(exports, "first", { enumerable: true, get: () => "m3.first by a getter" });
exports.second = 2;
console.log("m3 ends");
