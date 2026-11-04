const a = require("./lib-plain.cjs"), b = require("./lib-plain"), c = require(__dirname + "/lib-plain.cjs"), d = require("../" + require("path").basename(__dirname) + "/lib-plain.cjs");
new a.Maker(1); new b.Maker(2);
console.log(a === b, b === c, c === d, new d.Maker(3).describe(), a.hits());
