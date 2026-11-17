function show(v) { return typeof v + ":" + String(v); }
const kit = require("./kit.mjs");
module.exports = { kit, mark: show(kit.__esModule) };
