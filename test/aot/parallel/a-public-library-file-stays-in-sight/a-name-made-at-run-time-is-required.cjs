// A public library file that only written requests name stays in sight. Here a name that is made at run time comes to the same file: what is laid on it there is found through the written request.
const path = require("node:path");
const same = require(Buffer.from("6e6f64653a70617468", "hex").toString());
same.join = function () { return "changed"; };
console.log(path.join("a", "b"), same === path);
