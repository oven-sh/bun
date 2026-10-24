// `module.exports = K` where K is a class with a static field, and one more member stored behind the export.
const K = require("./k.cjs");
new K();
console.log(K.made, K.extra, require("./k.cjs") === K, Object.keys(K).join());
const { create } = K;
create();
console.log(K.made, K.name, new K() instanceof require("./k.cjs"));
