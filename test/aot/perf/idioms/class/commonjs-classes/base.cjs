"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function _export(target, all) {
  for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] });
}
_export(exports, {
  Base: function () {
    return Base;
  },
});
class Base {
  constructor(method, url, body) {
    this.method = method;
    this.url = url;
    this.body = body;
  }
  get cookies() {
    return this._cookies ? this._cookies : (this._cookies = 1);
  }
}
