// early.cjs and app.mjs form a cycle, so the engine's own loader loads the graph. It fetches early.cjs and list.json, then runs early.cjs, and only then makes the module of list.json.
// Until then a require() of list.json returns the value, not the namespace.
require("./app.mjs");
