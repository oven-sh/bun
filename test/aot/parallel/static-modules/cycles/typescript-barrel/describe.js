"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeAtLoad = exports.unitAtLoad = void 0;
exports.describe = describe;
const index_1 = require("./index");
function describe(square) {
    return square.side + index_1.unit;
}
exports.unitAtLoad = typeof index_1.unit;
exports.describeAtLoad = typeof index_1.describe;
