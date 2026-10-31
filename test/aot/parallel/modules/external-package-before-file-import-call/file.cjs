console.log("the file, before import()");
exports.value = 1;
import("./other.mjs");
console.log("the file, after import()");
