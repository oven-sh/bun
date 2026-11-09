var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var registry;
function add(name) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (registry === undefined) registry = [];
  registry.push(name);
  return registry.length;
}
var require_inner = __commonJS((exports, module) => { exports.count = add("first"); });
console.log(require_inner().count);
registry = ["fresh"];
console.log(add("second"));
