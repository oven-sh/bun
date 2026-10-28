const loaded: Record<string, unknown> = require("next/dist/compiled/babel-packages/packages-bundle.js");
console.log(typeof loaded, Object.keys(loaded).length > 0);
console.log("DONE");
