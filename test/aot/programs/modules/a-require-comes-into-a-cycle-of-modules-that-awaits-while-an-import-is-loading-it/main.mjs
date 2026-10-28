import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pending = import("./slow-a.mjs");
await 0;
await 0;
await 0;
await 0;
await 0;
await 0;
await 0;
await 0;
try {
  console.log(require("./slow-b.mjs").value);
} catch (error) {
  console.log(error.constructor.name, error.message.replace(/\S*slow-b.mjs/, "slow-b.mjs"));
}
await pending;
console.log(require("./slow-b.mjs").value);
