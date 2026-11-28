var __createBinding;
var __exportStar = function(m, o) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
};
function init() { __createBinding = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}; }
const names = {};
try { __exportStar({ a: 1 }, names); console.log(Object.keys(names).join()); } catch (e) { console.log(e.name, typeof __createBinding, Object.keys(names).length); }
