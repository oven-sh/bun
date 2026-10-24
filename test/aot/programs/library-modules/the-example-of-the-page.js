// The example of docs/bundler/aot-compatibility.mdx, "Built-in modules": node:path is imported by name, node:dgram is not, and the third name is no module. The names come from the environment. Plain Bun finds node:dgram.
import "node:path";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, Object.keys(require(name)).length > 0);
  } catch (error) {
    console.log(name, error.code, error.message.split(" (bun compile")[0]);
  }
}
