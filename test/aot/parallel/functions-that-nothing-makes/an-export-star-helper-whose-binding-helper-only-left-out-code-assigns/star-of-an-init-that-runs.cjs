var __createBinding;
var __exportStar = function(m, o) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
};
function init() { __createBinding = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}; }
const source = { a: 1 }, names = {};
try { __exportStar(source, names); } catch (e) { console.log(e.name, typeof __createBinding); }
init();
__exportStar(source, names);
source.a = 5;
console.log(names.a, Object.keys(names).join(), typeof Object.getOwnPropertyDescriptor(names, "a").get);
