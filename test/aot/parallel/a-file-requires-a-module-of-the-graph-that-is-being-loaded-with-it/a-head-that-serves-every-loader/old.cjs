console.log("old begins");
(function (root, factory) { if (typeof exports === "object") factory(exports, require("./side.mjs")); else factory(root); })(this, function (exports, side) { console.log("old has", side.width); exports.made = 1; });
console.log("old ends");
