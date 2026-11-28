// node:url is required and stored into before a file with named imports of it is linked: the named imports hold what was stored.
const url = require("node:url");
const kept = url.domainToASCII;
url.domainToASCII = () => "patched";
await import("./late.mjs");
console.log(kept("example.com"));
