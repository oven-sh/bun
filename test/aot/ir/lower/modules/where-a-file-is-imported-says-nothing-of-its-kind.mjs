// The .jsx files have nothing of CommonJS but `__filename`, in a package of type module. Each is imported, and required by a CommonJS file that runs amid the imports.
// A record says its kind where the module is no ES module.
// RUN(FRONT): link
// FRONT: module {{*}}path="{{*}}/front.jsx" displayPath="{{*}}front.jsx" flags=
// RUN(BOTH): link
// BOTH: module {{*}}path="{{*}}/both.jsx" displayPath="{{*}}both.jsx" flags=
// RUN(TWO): link
// TWO: module {{*}}path="{{*}}/two.jsx" displayPath="{{*}}two.jsx" flags=
// RUN(ABOVE): link
// ABOVE: module {{*}}path="{{*}}/above.jsx" displayPath="{{*}}above.jsx" flags=
// RUN(BEHIND): link
// BEHIND: module {{*}}path="{{*}}/behind.jsx" displayPath="{{*}}behind.jsx" flags=
// RUN(BELOW): link
// BELOW: module {{*}}path="{{*}}/below.jsx" displayPath="{{*}}below.jsx" flags=

// FILE: main.mjs
import "./front.jsx";
import "./both.jsx";
import "./two.jsx";
import "./level.mjs";
import "./real.cjs";
import "./other.cjs";
import "./behind.jsx";
import "./above.jsx";
export const again = () => require("./both.jsx");

// FILE: level.mjs
import "./below.jsx";
import "./deep.cjs";

// FILE: real.cjs
exports.all = [require("./front.jsx"), require("./both.jsx"), require("./two.jsx"), require("./behind.jsx"), require("./below.jsx")];

// FILE: other.cjs
exports.two = require("./two.jsx");

// FILE: deep.cjs
exports.above = require("./above.jsx");

// FILE: front.jsx
void __filename;
globalThis.seenInFront = true;

// FILE: both.jsx
void __filename;
globalThis.seenByBoth = true;

// FILE: two.jsx
void __filename;
globalThis.seenByTwo = true;

// FILE: above.jsx
void __filename;
globalThis.seenAbove = true;

// FILE: behind.jsx
void __filename;
globalThis.seenBehind = true;

// FILE: below.jsx
void __filename;
globalThis.seenBelow = true;

// FILE: package.json
{ "type": "module" }
