exports.got = "the fallback";
try { exports.got = require("./catalog.mjs").name; } catch {}
