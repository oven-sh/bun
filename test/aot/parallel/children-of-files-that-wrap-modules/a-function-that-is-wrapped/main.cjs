// A function that a bundle wraps is no module of the loader: it is no child of the file.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_lib = __commonJS(function (exports, module) { exports.helper = helper; function helper(e) { return e & 15; } });
let sum = 0;
for (let turn = 0; turn < 60; turn++) sum += require_lib().helper(turn);
console.log(sum, module.children.length, require.main.children.length);
