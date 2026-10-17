"use strict";
const { streamSym } = require("./symbols");
exports.readByAnotherRoad = function readByAnotherRoad(object) { return object[streamSym]; };
