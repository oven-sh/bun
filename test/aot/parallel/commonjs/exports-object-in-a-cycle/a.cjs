"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.late = exports.early = void 0;
exports.early = "early";
exports.changedByB = "stored by a";
exports.deletedByB = "stored by a";
exports.readItself = () => [exports.early, exports.late, exports.changedByB, typeof exports.b].join();
exports.addByCall = () => {
  exports.addedByCall = "added";
  return Object.keys(exports).join();
};
const b = require("./b.cjs");
exports.b = b;
exports.afterB = [exports.changedByB, exports.deletedByB, "deletedByB" in exports, exports.createdByB, exports.storedByB, exports.addedByCall].join();
exports.createdByB = "stored by a";
exports.late = "late";
