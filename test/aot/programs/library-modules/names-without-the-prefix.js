// `path` and `node:path` are one module: kept under either name, it is found under both. The same for a module that is not kept: both names fail alike, and the message names it with the prefix.
import "path";
import "node:os";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name), require(name) === require(name.startsWith("node:") ? name.slice(5) : "node:" + name));
  } catch (error) {
    console.log(name, error.code, error.message.split(":")[0] + ":" + error.message.split(":")[1] + ":" + error.message.split(":")[2].split(".")[0]);
  }
}
