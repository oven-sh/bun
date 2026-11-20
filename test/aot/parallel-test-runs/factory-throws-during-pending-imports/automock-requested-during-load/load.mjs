import { answer } from "./start.mjs";
export async function load() {
  try {
    return ["require", require("./config.mjs")];
  } catch (error) {
    const loading = import("./config.mjs");
    answer();
    return ["import behind " + error.name, await loading];
  }
}
