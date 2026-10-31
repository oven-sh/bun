// `import source x from ".."` and `import.source(..)`: `bun run` reports a syntax error and runs nothing, and so does the build.
import source text from "node:path";
console.log("never printed", typeof text);
const later = await import.source("node:fs");
console.log(typeof later);
/* Build errors:
error: TS1005: 'from' expected.
error: TS17012: 'source' is not a valid meta-property for keyword 'import'. Did you mean 'meta'?
*/
