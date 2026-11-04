const { createRequire } = require("node:module");
require = createRequire(__filename);
let binding = null;
const errors = [];
function load() {
  try { return require("./missing.linux-x64-gnu.node"); } catch (error) { errors.push(error); }
  try { return require("dep"); } catch (error) { errors.push(error); }
}
binding = load();
if (!binding) throw new Error("Cannot find native binding", { cause: errors });
console.log(binding.dep, errors.length);
