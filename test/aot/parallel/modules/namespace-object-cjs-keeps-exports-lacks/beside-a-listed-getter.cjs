var inner = require("./inner.cjs");
var json = require("./inner.json");
Object.defineProperty(exports, "x", { get: function () { return inner.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return json.x; } });
