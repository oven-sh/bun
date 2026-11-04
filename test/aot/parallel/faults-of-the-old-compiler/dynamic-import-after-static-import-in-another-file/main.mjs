// The static import and the import() as text are in different files: the static import is in a dependency, in a file that an earlier import() loaded,
// or in the importer of the file with the call, whose whole graph is loaded before any of it runs.
import { first } from "./imported.mjs";
import { loaded } from "./dependency.mjs";
import third from "./third.toml" with { type: "toml" };
const show = (loaded, imported) => console.log(loaded.default === imported, Object.keys(loaded).sort().join(), loaded.a);
show(await import("./first.toml", { with: { type: "text" } }), first);
const { second } = await import("./called.mjs");
show(await import("./second.yaml", { with: { type: "text" } }), second);
show(loaded, third);
