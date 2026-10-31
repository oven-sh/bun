const cut = path => path.replaceAll("\\", "/").replace(/.*\/lib/, "lib");
globalThis.required = (globalThis.required ?? 0) + 1;
module.exports = {
  order: globalThis.required,
  filename: cut(__filename),
  dirname: cut(__dirname),
  id: cut(module.id),
  moduleFilename: cut(module.filename),
  modulePath: cut(module.path),
  sibling: require("./sibling.cjs"),
};
