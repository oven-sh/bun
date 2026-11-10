// The getters are configurable and have setters: what is defined or stored over them is what is read.
var __defProp = Object.defineProperty;
var __returnValue = v => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name),
    });
};
var lib_exports = {};
__export(lib_exports, { add: () => add, count: () => count });
let count = 1; function add(a, b) { return a + b; }
const out = [];
for (let i = 0; i < 40; i++) { if (i === 20) lib_exports.count = "stored"; if (i === 30) Object.defineProperty(lib_exports, "add", { value: (a, b) => a * b }); if (i % 10 === 5) out.push(lib_exports.add(i, 2), lib_exports.count); }
[lib_exports].forEach(o => { delete o.count; }); out.push(String(lib_exports.count), Object.keys(lib_exports).join());
console.log(out.join(" "));
