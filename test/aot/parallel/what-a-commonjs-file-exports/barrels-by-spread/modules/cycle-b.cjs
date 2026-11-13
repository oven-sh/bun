"use strict";
module.exports = { ...require("./cycle-a.cjs"), fromB: "b", seenByB: Object.keys(require("./cycle-a.cjs")).join() };
