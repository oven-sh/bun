import "./other.mjs"; const { a, f } = require("./lib.mjs"); globalThis.sink = [a, f()];
