const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const place = pathToFileURL(__filename);
place.pathname = place.pathname.replace(/[^/]+$/, "another.cjs");
const load = createRequire(place);
console.log(typeof load("node:path").join, load.resolve("node:fs"));
