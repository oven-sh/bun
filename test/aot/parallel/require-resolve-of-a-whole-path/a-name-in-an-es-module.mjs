import fs from "node:fs";
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

console.log(
  "the free require",
  found(() => require.resolve("/etc/hosts")) === hosts,
);
console.log(
  "the module's own",
  found(() => import.meta.require.resolve("/etc/hosts")) === hosts,
);
console.log(
  "read",
  found(() => fs.readFileSync(require.resolve("/etc/hosts")).equals(fs.readFileSync(hosts))) === (hosts !== "MODULE_NOT_FOUND" || "MODULE_NOT_FOUND"),
);
console.log(
  "an address",
  import.meta.resolve("/etc/hosts") === Bun.pathToFileURL("/etc/hosts").href,
);
