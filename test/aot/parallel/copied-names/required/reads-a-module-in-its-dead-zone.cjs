function run(f) { return f(); }
let said;
try { said = run(a); } catch (e) { said = e.constructor.name; }
const path = require("node:path");
exports.said = said + " " + a();
function a() { return walk(); }
function walk() { return path.sep.length; }
