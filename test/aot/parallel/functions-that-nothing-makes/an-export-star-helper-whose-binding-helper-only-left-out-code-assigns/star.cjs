var __createBinding;
var __exportStar = function(m, o) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
};
function init() { __createBinding = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}; }
try { __exportStar({ a: 1, default: 2 }, exports); console.log(Object.keys(exports).join()); } catch (e) { console.log(e.name, typeof __createBinding, Object.keys(exports).length); }
try { __exportStar({ default: 2 }, exports); console.log("no names", Object.keys(exports).length); } catch (e) { console.log(e.name); }
