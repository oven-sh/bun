// createRequire() for another file is not the file's own require, but the name of a built-in module means the same from every file, also where the call chooses between two names.
import { createRequire } from "node:module";

const load = createRequire("/elsewhere/");
console.log(load(process.argv.length > 99 ? "node:dgram" : "node:querystring").stringify({ a: 1 }));
console.log(typeof createRequire("/elsewhere/")(process.argv.length > 99 ? "node:querystring" : "dgram").createSocket);
