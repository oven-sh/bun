async function run() {
  await import("./middle.mjs");
  return require("./middle.mjs");
}
const again = await run();
console.log(globalThis.seen.join(" "), typeof again);
