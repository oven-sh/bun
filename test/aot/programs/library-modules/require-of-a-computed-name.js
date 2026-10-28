// require(name): the call brings no library module into the executable. It finds the one that is imported by name, throws MODULE_NOT_FOUND for one that is not, and the program goes on. Plain Bun finds both.
import "node:path";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, error.code, error instanceof Error);
  }
}
console.log("went on");
