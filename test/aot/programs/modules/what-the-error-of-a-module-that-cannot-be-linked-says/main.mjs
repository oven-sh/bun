// A package that need not be installed: a module imports it by a static import, and the program reaches that module only by a load that it guards. The build goes through, and the load fails as in plain Bun.
// Its name, code, specifier, referrer and message.
await import("./broken.mjs").catch(e => console.log(e.name, "|", e.code, "|", e.specifier, "|", String(e.referrer).split(/[\\/]/).pop(), "|", String(e.message).replace(/from .*[\\/]/, "from ")));
