// An import under a type has loaded each file, so require() of its path returns the namespace of that import.
import settings from "./settings.toml" with { type: "toml" };
import * as list from "./list.yaml" with { type: "yaml" };
import note from "./note.json" with { type: "text" };
import { readNames } from "./reader.cjs";
console.log(settings.port, list.default.length, typeof note);
for (const name of readNames()) {
  console.log(name, readNames(name));
}
console.log(readNames("./list.yaml", list));
// Never runs. The executable holds the file without a type.
if (process.argv.length > 99) await import("./note.json");
