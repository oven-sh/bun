// `bun run` runs an imported CommonJS FILE while it loads the graph, so the jobs of such a file do run before the body of the importer. A bundle is no such file.
import { f } from "./front.cjs";
import { x } from "./bundle.mjs";
import { b } from "./behind.cjs";
console.log("body: main", f, x, b);
