const { Glob } = require("./parts.mjs"); console.log("SAID", [...new Glob("*.none").scanSync(".")].length);
