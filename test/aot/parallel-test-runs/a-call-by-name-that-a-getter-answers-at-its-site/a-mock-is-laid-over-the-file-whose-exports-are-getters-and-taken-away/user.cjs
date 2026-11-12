"use strict";
const lib = require("./lib.cjs");
exports.held = turns => { let s = 0; for (let i = 0; i < turns; i++) s = (s + lib.add(i, 2) + lib.low(i)) | 0; return s; };
exports.asked = turns => { let s = 0; for (let i = 0; i < turns; i++) { const now = require("./lib.cjs"); s = (s + now.add(i, 2) + now.low(i)) | 0; } return s; };
