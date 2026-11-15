"use strict";
module.exports = { ...require("./sometimes.cjs") };
require("./sometimes.cjs").added = "too late";
