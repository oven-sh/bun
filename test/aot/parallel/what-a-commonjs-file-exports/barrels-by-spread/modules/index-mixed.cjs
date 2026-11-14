"use strict";
module.exports = Object.assign({}, require("./plain.cjs"), { deep: { one: "one", ...require("./plain.cjs") } }, require("./index-spread.cjs"));
