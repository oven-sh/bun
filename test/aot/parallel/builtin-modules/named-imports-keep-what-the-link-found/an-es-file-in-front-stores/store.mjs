import path from "node:path";
path.sep = "!";
path.join = () => "patched";
console.log("stored");
