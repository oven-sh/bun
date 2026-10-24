// import.meta.require(name) follows the rules of require(name).
import "node:path";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof import.meta.require(name));
  } catch (error) {
    console.log(name, error.code, error instanceof Error);
  }
}
console.log("went on");
