// A module that binds a name which a module of the library does not have fails to link: every time it is imported, with the same error, which names what that module binds. Every other module over the same module of the library links and runs, before it and behind it.
import { existsSync } from "node:fs";

async function attempt(label, load) {
  try {
    const namespace = await load();
    console.log(label, "loaded", Object.keys(namespace).length);
    return namespace;
  } catch (error) {
    console.log(label, error.name, error.message);
    return error;
  }
}

// The two wordings for a name that is handed on are not compared here.
async function attemptHandedOn(label, load) {
  try {
    const namespace = await load();
    console.log(label, "loaded", Object.keys(namespace).join());
  } catch (error) {
    console.log(label, error.name, error.message.includes("'absent'"));
  }
}

console.log("entry point", typeof existsSync);
await attempt("reads before", () => import("./reads-exists.mjs"));

const first = await attempt("binds absent", () => import("./binds-absent.mjs"));
await attempt("reads behind", () => import("./reads-stat.mjs"));
const second = await attempt("binds absent again", () => import("./binds-absent.mjs"));
console.log("the same error", first === second);

await attempt("binds zebra", () => import("./binds-zebra.mjs"));
await attempt("binds aardvark", () => import("./binds-aardvark.mjs"));
await attempt("binds zebra again", () => import("./binds-zebra.mjs"));
await attempt("binds both", () => import("./binds-zebra-and-aardvark.mjs"));
await attempt("imports one that binds zebra", () => import("./imports-one-that-binds-zebra.mjs"));

await attempt("cycle", () => import("./cycle-a.mjs"));
await attempt("member of the cycle", () => import("./cycle-c.mjs"));
await attempt("beside the cycle", () => import("./reads-read-file.mjs"));

await attemptHandedOn("hands on absent", () => import("./hands-on-absent.mjs"));
await attemptHandedOn("binds what is handed on", () => import("./binds-what-is-handed-on.mjs"));
await attemptHandedOn("hands on what is there", () => import("./hands-on-what-is-there.mjs"));

await attempt("namespace and absent", () => import("./binds-namespace-and-absent.mjs"));
await attempt("namespace", () => import("./reads-namespace.mjs"));
await attempt("default", () => import("./reads-default.mjs"));
await attempt("every name", () => import("./hands-on-every-name.mjs"));

await attempt("path: binds absent", () => import("./binds-absent-of-path.mjs"));
await attempt("path: reads", () => import("./reads-path.mjs"));
await attempt("sqlite: binds absent", () => import("./binds-absent-of-sqlite.mjs"));
await attempt("sqlite: reads", () => import("./reads-sqlite.mjs"));

console.log("require", typeof require("node:fs").existsSync, require("node:fs").absent);
try {
  require("./binds-absent.mjs");
} catch (error) {
  console.log("require of the one that binds absent", error.name, error.message);
}
