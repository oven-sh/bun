import { createRequire } from "node:module";
function see(moduleUrl) {
  const require = createRequire(moduleUrl);
  try {
    console.log("SAID", require("./blank.json"));
  } catch (error) {
    console.log("SAID blank threw", error.name, "|", error.message);
  }
  try {
    console.log("SAID", require("./broken.json"));
  } catch (error) {
    console.log("SAID broken threw", error.name);
  }
  console.log("SAID", require("./there.json").version);
}
see(import.meta.url);
