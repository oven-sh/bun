// `require("./barrel.mjs").name`: the barrel stars a file that has the name and stars a CommonJS file or a built-in module that has it too. The file's own name hides theirs.
console.log("port", require("./barrel.mjs").port);
console.log(typeof require("./paths-barrel.mjs").join, require("./paths-barrel.mjs").join("a", "b"));
console.log(require("./far.mjs").host || "nobody", typeof require("./far.mjs")["host"]);
console.log("shared", require("./two.mjs").shared, "only", require("./two.mjs").only);
import("./barrel.mjs").then(barrel => console.log("imported", barrel.port, barrel.user));
