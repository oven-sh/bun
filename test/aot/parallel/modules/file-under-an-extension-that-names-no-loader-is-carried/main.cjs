// Reference: bun build --compile
// `bun build` links these calls and carries the files, whatever they hold. Each answers a path.
const name = path => path.replace(/^.*[\\/]/, "").replace(/-[a-z0-9]+\./, ".");
console.log(name(require("./code.bin")), name(module.require("./prose.conf")));
console.log(require("node:fs").readFileSync(require("./prose.conf"), "utf8").trim());
