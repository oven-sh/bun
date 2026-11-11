export async function load() {
  try {
    return ["require", require("./config.mjs")];
  } catch (error) {
    return ["import behind " + error.name, await import("./config.mjs")];
  }
}
