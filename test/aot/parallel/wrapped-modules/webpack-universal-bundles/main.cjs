// STATISTIC: KnownHelperCalls >= 2
const library = require("./library.cjs");
const minified = require("./minified.cjs");
console.log(library.run(100), new library.Point(4).twice(), library.run.name);
console.log(minified.run(100), new minified.Point(4).twice(), minified.run.name);
