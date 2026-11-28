// A file URL may leave out the two slashes in front of its empty host: createRequire() takes it for the same file.
const { createRequire } = require("node:module");
const tried = (label, f) => { try { console.log(label, f()); } catch (e) { console.log(label, e.code ?? e.name); } };
tried("one slash", () => createRequire("file:" + __filename)("./a.cjs").name);
tried("three slashes", () => createRequire("file://" + __filename)("./a.cjs").name);
tried("capitals", () => createRequire("FILE:" + __filename)("./a.cjs").name);
tried("the folder", () => createRequire("file:" + __dirname + "/")("./a.cjs").name);
tried("another file", () => createRequire("file:" + __dirname + "/other.cjs")("./a.cjs").name);
tried("another scheme", () => createRequire("http:" + __filename));
tried("not there", () => createRequire("file:" + __filename)("./none.cjs"));
