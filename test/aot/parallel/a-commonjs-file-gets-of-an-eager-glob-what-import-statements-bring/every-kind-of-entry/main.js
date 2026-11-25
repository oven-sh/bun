// Reference: bun build --compile
const { basename } = require("node:path");
const describe = value =>
  value === null || typeof value !== "object" ? typeof value + ":" + JSON.stringify(value) : "{" + Object.keys(value).sort().map(key => key + ":" + typeof value[key]).join() + "}";
const show = (label, table) => console.log(label, "|", Object.keys(table).map(key => basename(key) + "=" + describe(table[key])).join(" "));
show("commonjs whole", import.meta.glob("./mods/*.cjs", { eager: true }));
show("commonjs default", import.meta.glob("./mods/*.cjs", { eager: true, import: "default" }));
show("commonjs name", import.meta.glob("./mods/object.cjs", { eager: true, import: "a" }));
show("module whole", import.meta.glob("./mods/*.mjs", { eager: true }));
show("module default", import.meta.glob("./mods/*.mjs", { eager: true, import: "default" }));
show("module name", import.meta.glob("./mods/*.mjs", { eager: true, import: "b" }));
show("data whole", import.meta.glob("./mods/*.json", { eager: true }));
show("data default", import.meta.glob("./mods/*.json", { eager: true, import: "default" }));
show("data name", import.meta.glob("./mods/*.json", { eager: true, import: "n" }));
show("text whole", import.meta.glob("./mods/*.txt", { eager: true, query: "?raw" }));
show("text default", import.meta.glob("./mods/*.txt", { eager: true, query: "?raw", import: "default" }));
show("text of code", import.meta.glob("./texts/*.mjs", { eager: true, query: "?raw", import: "default" }));
show("lazy", import.meta.glob("./mods/*.cjs"));
show("none", import.meta.glob("./mods/*.nothing", { eager: true }));
console.log(Object.keys(import.meta.glob("./mods/*.cjs", { eager: true })).map(key => basename(key)).join());
exports.done = true;
