// Reference: bun build --compile
// The static import as TOML is in a file that only one other file imports. An executable has the file as one module, of the type that the scan of the bundler comes to first: the import() as text of this file, and the static import gets the text too.
// Under `bun run` both have run first, so the call gets the TOML module.
import { doubled } from "./mid.mjs";
const loaded = await import("./conf.toml", { with: { type: "text" } });
console.log(doubled, typeof loaded.default, Object.keys(loaded).sort().join());
