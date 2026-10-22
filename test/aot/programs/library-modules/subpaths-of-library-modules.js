// node:fs/promises, node:path/posix and node:util/types are modules of their own. Each is kept by its own name; a subpath that nothing names is not in, even where the module above it is.
import "node:fs/promises";
import "node:path";
import "node:util/types";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, error.code);
  }
}
