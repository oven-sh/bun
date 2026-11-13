"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var leaf = _interopRequireWildcard(require("./babel-leaf.cjs"));
var plain = _interopRequireWildcard(require("./plain.cjs"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function sum(count) {
    let total = new leaf.Babel(0, 0);
    for (let i = 0; i < count; i++)
        total = total.add(new leaf.Babel(i, 1));
    return total.x + total.y;
}
exports.sum = sum;
exports.name = leaf.default;
exports.plain = [Object.keys(plain).join(), plain.default === require("./plain.cjs"), plain.own, Object.getPrototypeOf(plain)];
