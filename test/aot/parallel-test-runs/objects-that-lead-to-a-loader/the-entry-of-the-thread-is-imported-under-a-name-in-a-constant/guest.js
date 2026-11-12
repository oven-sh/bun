import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
async function run() {
  const said = [typeof require("node:module").createRequire];
  const main = "bun:main";
  try {
    const loaded = await import(main);
    said.push(typeof loaded + " " + Object.keys(loaded).length);
  } catch (error) {
    said.push("it throws " + error.code);
  }
  postMessage(said.join(", "));
}
void run();
