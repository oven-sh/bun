const lib = require("./lib-members.cjs");
function use(s) { return require("./lib-members.cjs").pad(s); }
let out = "";
for (let i = 0; i < 100; i++) out = use("c");
lib.pad = (s) => "[" + s + "]";
for (let i = 0; i < 100; i++) out += use("d").length;
console.log(out.length, use("e"));
delete lib.pad;
try { use("f"); } catch (error) { console.log(error.constructor.name); }
