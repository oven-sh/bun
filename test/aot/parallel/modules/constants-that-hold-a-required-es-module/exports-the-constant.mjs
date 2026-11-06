export const held = require("./looked-at.mjs");
const alsoHeld = require("./looked-at.mjs");
export { alsoHeld as renamed };
say("in the file that exports the constants:", held.one, alsoHeld.two);
export const unnamed = require("./named-by-nobody.mjs");
