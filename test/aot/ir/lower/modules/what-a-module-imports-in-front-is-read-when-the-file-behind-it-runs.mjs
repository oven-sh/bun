// front.cjs, both.cjs, above.cjs, behind.cjs and below.cjs say nothing of CommonJS in their texts: to the loader behind `import` each is an ES module, to the one behind `require` CommonJS.
// real.cjs runs where the loader comes to it, amid the statements of main.mjs. The requests of main.mjs go out together, in the order in which they are written: the loader has read front.cjs by then, and the require takes the ES module.
// RUN(FRONT): link
// A record says its kind where the module is no ES module.
// FRONT: module {{*}}path="{{*}}/front.cjs" displayPath="{{*}}front.cjs" flags=
// Each load is asked by itself: main.mjs requires both.cjs too, behind all of its statements.
// RUN(BOTH): link
// BOTH: module {{*}}path="{{*}}/both.cjs" displayPath="{{*}}both.cjs" flags=
// So is each of two that run amid the statements: real.cjs and other.cjs both require two.cjs, which stands in front of both. The lowest file above the two loads is main.mjs, of which the rule says nothing.
// RUN(TWO): link
// TWO: module {{*}}path="{{*}}/two.cjs" displayPath="{{*}}two.cjs" flags=
// deep.cjs runs amid the statements of level.mjs. What main.mjs imports was asked for when main.mjs was read, sooner than anything below level.mjs: wherever it stands there.
// RUN(ABOVE): link
// ABOVE: module {{*}}path="{{*}}/above.cjs" displayPath="{{*}}above.cjs" flags=
// Of what stands behind real.cjs, or a level below a module in front of it, nothing is claimed: the require may be the first to read it.
// RUN(BEHIND): link
// BEHIND: module {{*}}path="{{*}}/behind.cjs"{{*}} kind=CommonJs
// RUN(BELOW): link
// BELOW: module {{*}}path="{{*}}/below.cjs"{{*}} kind=CommonJs

// FILE: main.mjs
import "./front.cjs";
import "./both.cjs";
import "./two.cjs";
import "./level.mjs";
import "./real.cjs";
import "./other.cjs";
import "./behind.cjs";
import "./above.cjs";
export const again = () => require("./both.cjs");

// FILE: level.mjs
import "./below.cjs";
import "./deep.cjs";

// FILE: real.cjs
exports.all = [require("./front.cjs"), require("./both.cjs"), require("./two.cjs"), require("./behind.cjs"), require("./below.cjs")];

// FILE: other.cjs
exports.two = require("./two.cjs");

// FILE: deep.cjs
exports.above = require("./above.cjs");

// FILE: front.cjs
globalThis.seenInFront = true;

// FILE: both.cjs
globalThis.seenByBoth = true;

// FILE: two.cjs
globalThis.seenByTwo = true;

// FILE: above.cjs
globalThis.seenAbove = true;

// FILE: behind.cjs
globalThis.seenBehind = true;

// FILE: below.cjs
globalThis.seenBelow = true;
