// An ES file that the program writes and loads at run time requires itself while it runs. Its "module.exports" export is ready then, and its `__esModule` export is not: require() hands out the value of the first, then and later.
// Flags: --aot-allow-code-from-disk
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// The compiler can't see text that is decoded at run time.
const decoded = text => Buffer.from(text).toString();

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "code-beside-mark-"));
const file = path.join(folder, "late.mjs");
fs.writeFileSync(
  file,
  `
const custom = { custom: true };
export { custom as "module.exports" };
globalThis.inner = require("./late.mjs");
export let __esModule = true;
`,
);
const tag = value => (value?.custom === true ? "custom" : Object.prototype.toString.call(value));

import(decoded(file))
  .then(() => console.log("inside the run", tag(globalThis.inner), "| later", tag(require(decoded(file)))))
  .finally(() => fs.rmSync(folder, { recursive: true }));
/* Output:
inside the run custom | later custom
*/
