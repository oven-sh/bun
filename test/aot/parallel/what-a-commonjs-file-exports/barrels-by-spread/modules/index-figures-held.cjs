"use strict";
const figures = require("./figures.cjs"), { scale } = figures;
module.exports = { ...figures, scaled: (x) => scale(x, 2), name: "held" };
