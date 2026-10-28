const { basename } = require("node:path");
const names = JSON.parse(process.env.NAMES ?? '["./module.mjs", "./data.json", "./file.cjs"]');
for (const name of [...names, ...names, ...names]) {
  require(name);
  console.log(name, module.children.map(child => basename(child.filename)).join());
}
