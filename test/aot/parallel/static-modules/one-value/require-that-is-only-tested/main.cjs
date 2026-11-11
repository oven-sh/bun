// A call of require() that is only tested: a module that is one value may be false, null, zero or an empty text, and the test says so.
console.log("false", require("./false.cjs") ? "on" : "off", !require("./false.cjs"), require("./false.cjs") == null, require("./false.cjs") && "behind");
console.log("null", require("./null.cjs") ? "on" : "off", !require("./null.cjs"), require("./null.cjs") == null, require("./null.cjs") === null, require("./null.cjs") !== undefined);
console.log("zero", require("./zero.cjs") ? "on" : "off", !require("./zero.cjs"), require("./zero.cjs") != null);
console.log("empty", require("./empty.cjs") ? "on" : "off", !require("./empty.cjs"));
console.log("undefined", require("./undefined.cjs") ? "on" : "off", require("./undefined.cjs") === undefined, require("./undefined.cjs") == null);
console.log("one", require("./one.cjs") ? "on" : "off", !require("./one.cjs"), require("./one.cjs") == null);
console.log("names", require("./names.cjs") ? "on" : "off", !require("./names.cjs"), require("./names.cjs") == null);
if (require("./false.cjs")) console.log("taken");
else console.log("not taken");
let turns = 0;
while (require("./zero.cjs")) if (++turns > 3) break;
for (; require("./null.cjs"); ) if (++turns > 3) break;
do turns += 10; while (require("./empty.cjs"));
console.log(turns);
