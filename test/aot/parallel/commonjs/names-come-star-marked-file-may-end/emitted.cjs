"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flag = exports.count = void 0;
exports.default = "a default of its own";
exports.count = 0;
exports.flag = false;
Promise.resolve().then(() => {
  exports.flag = "stored again";
});
Promise.resolve().then(() => {
  exports.added = 1;
});
