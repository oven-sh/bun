"use strict";
var bind = (this && this.bind) || (Object.create ? function (target, source, key, as) {
  if (as === void 0) {
    as = key;
  }
  Object.defineProperty(target, as, { get: () => source[key], enumerable: true });
} : function (target, source, key, as) {
  if (as === void 0) {
    as = key;
  }
  target[as] = source[key];
});
var bindAll = (this && this.bindAll) || function (source, target) {
  for (const key in source) {
    if (key !== "default" && !Object.prototype.hasOwnProperty.call(target, key)) {
      bind(target, source, key);
    }
  }
};
Object.defineProperty(exports, "__esModule", { value: true });
bindAll(require("./by-hand-inner.js"), exports);
