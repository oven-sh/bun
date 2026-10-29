// `import.meta.resolve` joins a relative specifier to the URL of the importer and never looks for the file, so it adds no extension. A `node:` or `bun:` specifier comes back as written.
import { value } from "./util";

const lastSegment = url => url.slice(url.lastIndexOf("/"));
console.log(value, lastSegment(import.meta.resolve("./util")), lastSegment(import.meta.resolve("./util.js")));
console.log(lastSegment(import.meta.resolve("./none")), lastSegment(import.meta.resolve("../none")));
console.log(import.meta.resolve("node:fs"), import.meta.resolve("node:none"), import.meta.resolve("bun:none"));
