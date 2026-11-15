// `path` and `node:path` are one module: it is found under both names, whether or not the program names it, as in `bun <file>`.
// Flags: --aot-refuse-code-from-disk
// Env: NAMES=path,node:path,os,node:os,dgram,node:dgram
import "path";
import "node:os";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name), require(name) === require(name.startsWith("node:") ? name.slice(5) : "node:" + name));
  } catch (error) {
    console.log(name, error.code, error.message.split(":")[0] + ":" + error.message.split(":")[1] + ":" + error.message.split(":")[2].split(".")[0]);
  }
}
