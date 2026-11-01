const fs = require("node:fs");
fs.existsSync = () => "patched";
fs.addedByPatch = () => "added";
console.log("patch ran");
