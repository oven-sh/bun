const kind = require("./kind-that-loads.cjs");
kind.wanted = ["node:", "zlib"].join("");
console.log("SAID", process instanceof kind);
