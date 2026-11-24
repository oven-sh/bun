const told = value => value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "{" + Object.keys(value).join() + "}" : typeof value;
const got = [];
const step = async (name, deed) => { try { got.push([name, await deed()]); } catch (error) { got.push([name, "threw " + error.name]); } };
(async () => {
  await step("It", () => import("./part.cjs", { with: { type: "json" } }));
  await step("R", () => require("./part.cjs"));
  const said = got.map(([name, value], place) => name + " " + (typeof value === "string" && value.startsWith("threw") ? value : told(value)) + got.slice(0, place).map(([other, earlier], at) => value === earlier && value !== undefined && typeof value === "object" ? " =" + at : "").join(""));
  console.log("SAID", said.join(" | "), "| ran", globalThis.ran ?? 0, "| a", typeof globalThis.a);
})();
