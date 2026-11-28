// plain.jsx has nothing of CommonJS but `__filename`, in a package of type module. It is an ES module to the statement and to the require in real.cjs, and has its turn among the modules.
// A record says its kind where the module is no ES module.
// RUN(PLAIN): link
// PLAIN: module {{*}}path="{{*}}/plain.jsx" displayPath="{{*}}plain.jsx" flags=
// RUN(ROOT): link
// ROOT: module {{*}}path="{{*}}/main.mjs"{{*}} requests=[{target=m{{*}} isHoisted=true}, {target=m{{*}} completes=true}, {target=m{{*}} completes=true}]

// FILE: main.mjs
import "./real.cjs";
import "./plain.jsx";

// FILE: real.cjs
exports.load = () => require("./plain.jsx");

// FILE: plain.jsx
void __filename;
globalThis.seen = true;

// FILE: package.json
{ "type": "module" }
