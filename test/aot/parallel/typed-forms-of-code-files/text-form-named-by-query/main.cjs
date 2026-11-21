// A query that spells a type doesn't name the file in that type. It's refused like any query that only the running program knows.
const query = ["./gong.cjs", process.argv.length > 90 ? "never" : "text"].join("?");
const describe = value => (typeof value === "object" ? Object.keys(value).join() : typeof value);
(async () => {
  try {
    console.log("first", describe(require(query)));
  } catch (error) {
    console.log("first", error.code);
  }
  const text = await import("./gong.cjs", { with: { type: "text" } });
  const again = require("./gong.cjs", { type: "text" });
  const later = await import("./gong.cjs");
  console.log(typeof text.default, describe(again), describe(later), globalThis.struck);
})();

/* Output:
first MODULE_NOT_FOUND
string default default,rang 1
*/
