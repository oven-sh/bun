// plain.jsx has nothing of CommonJS but `__filename`, in a package of type module: to the loader behind `import` it is an ES module, to the one behind `require` CommonJS. The statements below main.mjs have loaded it by the time
// any code of main.mjs or of loads.mjs runs, so neither the require that names it nor the one that names the module above it reads it.
// RUN(LINKED): link
// A record says its kind where the module is no ES module.
// LINKED: module {{*}}path="{{*}}/plain.jsx" displayPath="{{*}}plain.jsx" flags=

// FILE: main.mjs
import "./loads.mjs";
import "./middle.mjs";
export const again = () => require("./middle.mjs");

// FILE: loads.mjs
export const load = () => require("./plain.jsx");

// FILE: middle.mjs
import "./plain.jsx";

// FILE: plain.jsx
void __filename;
globalThis.seen = true;

// FILE: package.json
{ "type": "module" }
