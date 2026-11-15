// plain.cjs says nothing of CommonJS in its text: to the loader behind `import` it is an ES module, to the one behind `require` CommonJS. The statements below main.mjs have loaded it by the time
// any code of main.mjs or of loads.mjs runs, so neither the require that names it nor the one that names the module above it reads it.
// RUN(LINKED): link
// A record says its kind where the module is no ES module.
// LINKED: module {{*}}path="{{*}}/plain.cjs" displayPath="{{*}}plain.cjs" flags=

// FILE: main.mjs
import "./loads.mjs";
import "./middle.mjs";
export const again = () => require("./middle.mjs");

// FILE: loads.mjs
export const load = () => require("./plain.cjs");

// FILE: middle.mjs
import "./plain.cjs";

// FILE: plain.cjs
globalThis.seen = true;
