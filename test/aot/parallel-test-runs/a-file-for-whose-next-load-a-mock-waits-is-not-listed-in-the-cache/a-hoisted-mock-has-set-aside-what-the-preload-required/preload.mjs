globalThis.requiredByThePreload = require("./part.cjs");
globalThis.listedInThePreload = require.resolve("./part.cjs") in require.cache;
