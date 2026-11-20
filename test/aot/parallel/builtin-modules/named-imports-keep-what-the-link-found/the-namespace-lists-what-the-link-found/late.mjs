import * as names from "node:path";
console.log("sep" in names, "nope" in names, Object.keys(names).sort().join(" "));
