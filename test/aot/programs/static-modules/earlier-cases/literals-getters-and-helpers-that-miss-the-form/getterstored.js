"use strict";
const plain_1 = require("./plain");
Object.defineProperty(exports, "p", { enumerable: true, get: function () { return plain_1.p; } });
try { exports.p = "stored"; } catch (e) { exports.threw = e.constructor.name; }
