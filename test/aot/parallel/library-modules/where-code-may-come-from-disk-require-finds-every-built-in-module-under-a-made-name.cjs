// Where code may come from disk a name from outside finds every built-in module, as in `bun <file>`, whether or not a load of the program names it.
// Flags: --aot-allow-code-from-disk
// Env: NAMES_OF_MODULES=node:os,path,node:crypto,node:punycode,node:dgram,node:process,bun,node:util
for (const name of process.env.NAMES_OF_MODULES.split(",")) {
  const made = require(name);
  console.log(name, typeof made, Object.keys(made).length > 3);
}
console.log(require(process.env.NAMES_OF_MODULES.split(",")[2]).createHash("sha1").update("a").digest("hex").slice(0, 8));
