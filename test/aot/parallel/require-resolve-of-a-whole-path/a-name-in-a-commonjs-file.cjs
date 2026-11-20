const fs = require("node:fs");
const lies = name => {
  try {
    return fs.realpathSync(name);
  } catch {
    return "MODULE_NOT_FOUND";
  }
};
const found = resolve => {
  try {
    return resolve();
  } catch (error) {
    return error.code;
  }
};
const hosts = lies("/etc/hosts");
const size = hosts === "MODULE_NOT_FOUND" ? "none" : fs.readFileSync(hosts).length;
const read = name => (name === "MODULE_NOT_FOUND" ? "none" : fs.readFileSync(name).length);

console.log(
  "written",
  found(() => require.resolve("/etc/hosts")) === hosts,
);
console.log("read", found(() => read(require.resolve("/etc/hosts"))) === size);

const name = "/etc/hosts";
console.log(
  "a constant",
  found(() => require.resolve(name)) === hosts,
);

function where(other) {
  return require.resolve(other ? "/etc/hosts" : "/etc/passwd");
}
console.log(
  "one of two",
  found(() => where(true)) === hosts,
  found(() => where(false)) === lies("/etc/passwd"),
);

const wrap = (run, module) => () => (module || run((module = { exports: {} }).exports, module), module.exports);
const part = wrap((exports, module) => {
  exports.hosts = found(() => require.resolve("/etc/hosts"));
});
console.log("inside a wrapped module", part().hosts === hosts);

console.log(
  "twice",
  found(() => require.resolve("/etc/hosts") === require.resolve("/etc/hosts")) === (hosts !== "MODULE_NOT_FOUND" || "MODULE_NOT_FOUND"),
);
console.log(
  "there is none",
  found(() => require.resolve("/etc/there/is/none/of/this/name")),
);
