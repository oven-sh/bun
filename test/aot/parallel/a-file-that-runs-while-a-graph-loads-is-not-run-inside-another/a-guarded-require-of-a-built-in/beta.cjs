var crypto;
try { crypto = require("crypto"); } catch (e) { crypto = undefined; }
exports.kind = crypto ? "has crypto" : "NO CRYPTO";
