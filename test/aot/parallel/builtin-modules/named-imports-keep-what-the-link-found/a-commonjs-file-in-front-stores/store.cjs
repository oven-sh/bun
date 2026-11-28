const path = require("node:path");
path.sep = "!";
path.join = () => "patched";
console.log("stored");
