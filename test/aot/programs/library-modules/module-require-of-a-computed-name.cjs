// module.require(name) in a CommonJS file follows the rules of require(name).
require("node:path");

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof module.require(name));
  } catch (error) {
    console.log(name, error.code, error instanceof Error);
  }
}
console.log("went on");
