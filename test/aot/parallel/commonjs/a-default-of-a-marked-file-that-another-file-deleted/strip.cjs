"use strict";
delete require("./shelf.cjs").default;
const weights = require("./weights.cjs");
for (const name of ["default", "late"]) weights[name] = [name];
delete weights.default;
Reflect.deleteProperty(require("./rooms.cjs"), "size");
require("./empty.cjs").default = undefined;
