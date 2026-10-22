// `module.exports = require(K)` and nothing else, where K is no CommonJS module of the program: data, an ES module, an ES module
// that exports "module.exports", a module of the runtime. What `require` answers for K is what the file exports.
const data = require("./hands-on-data.cjs");
console.log(data.x, data.y.length, Object.keys(data).join());
const es = require("./hands-on-es.cjs");
console.log(es.a, typeof es.f, es.f(), Object.keys(es).join(), es[Symbol.toStringTag]);
const marked = require("./hands-on-marked.cjs");
console.log(typeof marked, marked.inner, marked.other);
const path = require("./hands-on-runtime.cjs");
console.log(path.basename("/a/b.txt"), path === require("node:path"));
console.log(data === require("./db.json"), es === require("./es.mjs"), marked === require("./marked.mjs"));
