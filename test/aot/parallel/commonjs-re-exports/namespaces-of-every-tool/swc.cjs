"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
const leaf = /*#__PURE__*/ _interop_require_wildcard(require("./swc-leaf.cjs"));
const plain = /*#__PURE__*/ _interop_require_wildcard(require("./plain.cjs"));
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
function sum(count) {
    let total = new leaf.Swc(0, 0);
    for (let i = 0; i < count; i++)
        total = total.add(new leaf.Swc(i, 1));
    return total.x + total.y;
}
exports.sum = sum;
exports.name = leaf.default;
exports.plain = [Object.keys(plain).join(), plain.default === require("./plain.cjs"), plain.own, Object.getPrototypeOf(plain)];
