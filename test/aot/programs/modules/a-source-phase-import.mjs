// `import source x from ".."` and `import.source(..)`: `bun run` reports a syntax error and runs nothing, and so does the build.
import source text from "node:path";
console.log("never printed", typeof text);
const later = await import.source("node:fs");
console.log(typeof later);
