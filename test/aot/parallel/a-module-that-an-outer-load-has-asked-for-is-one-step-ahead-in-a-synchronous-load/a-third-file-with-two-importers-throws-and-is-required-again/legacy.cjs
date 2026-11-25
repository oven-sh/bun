let said;
try { said = require("./service.mjs").service; } catch (e) { said = "service failed: " + e.message; }
let again;
try { again = typeof require("./third.cjs"); } catch (e) { again = "threw " + e.message; }
let service;
try { service = typeof require("./service.mjs").service; } catch (e) { service = "threw " + e.message; }
console.log("SAID legacy:", said, "| third again:", again, "| service again:", service, "| runs:", globalThis.runs_third);
module.exports = "legacy: " + said;
