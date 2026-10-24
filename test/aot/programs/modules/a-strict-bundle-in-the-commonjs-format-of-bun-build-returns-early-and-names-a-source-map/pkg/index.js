// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {"use strict";
var path = require("path");
exports.strict = (function () { return this === undefined; })();
exports.file = path.basename(__filename);
exports.early = 1;
if (exports.early) return;
exports.late = 2;
})

//# sourceMappingURL=index.js.map
