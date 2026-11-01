var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "absent", { enumerable: true, get: function () { return below_1.absent; } });
Object.defineProperty(exports, "never", { enumerable: true, get: function () { return below_1.never; } });
Object.defineProperty(exports, "held", { enumerable: true, get: function () { return below_1.held; } });
Object.defineProperty(exports, "later", { enumerable: true, get: function () { return below_1.later; } });
Object.defineProperty(exports, "present", { enumerable: true, get: function () { return below_1.present; } });
Object.defineProperty(exports, "fill", { enumerable: true, get: function () { return below_1.fill; } });
exports.read = function () {
  return below_1.later;
};
