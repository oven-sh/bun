const STAGE = require("./stage.cjs");
const tag = (strings) => strings;
STAGE.count = (STAGE.count || 0) + 1;
const made = tag`x${0}y`;
[STAGE.report][JSON.parse("0")](() => made);
if (STAGE.count < 3) throw new Error("run " + STAGE.count);
