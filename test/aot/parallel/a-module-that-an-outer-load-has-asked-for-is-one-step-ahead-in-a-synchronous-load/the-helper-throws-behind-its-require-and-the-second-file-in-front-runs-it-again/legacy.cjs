let said;
try { said = require("./service.mjs").service; } catch (e) { said = "service failed: " + e.message; }
let again;
try { again = typeof require("./helper.cjs"); } catch (e) { again = "threw " + e.message; }
let service;
try { service = typeof require("./service.mjs").service; } catch (e) { service = "threw " + e.message; }
console.log("SAID legacy:", said, "| helper again:", again, "| service again:", service, "| runs:", globalThis.runs_helper);
module.exports = "legacy: " + said;
