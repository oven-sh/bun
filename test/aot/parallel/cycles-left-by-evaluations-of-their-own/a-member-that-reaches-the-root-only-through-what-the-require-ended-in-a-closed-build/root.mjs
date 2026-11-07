import "./helper.mjs";
import "./late.mjs";
if (Date.now() > 0) throw new Error("root fell");
