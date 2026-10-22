const a = require("./a.cjs");
globalThis.seenByB = a.early + ":" + a.late;
throw new Error("b fails");
