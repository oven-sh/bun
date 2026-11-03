"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function _export(target, all) {
  for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] });
}
_export(exports, {
  Wrapped: function () {
    return Wrapped;
  },
});
const _index = require("./base.cjs");
let prop;
const MARK = Symbol.for("mark");
class Wrapped extends _index.Base {
  static #_ = (prop = MARK);
  constructor(_req) {
    super(_req.method.toUpperCase(), _req.url, _req), (this._req = _req), (this.headers = this._req.headers), (this[MARK] = this._req[MARK] || {}), (this.streaming = false);
  }
  get original() {
    return this._req;
  }
}
