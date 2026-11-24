// A variable of a loop body has the name that the wrapper gives to the module of the file: it is stored ahead of every read, and the file's own exports are laid as written.
"use strict";
var tables = [
  { left: 1, right: number => number + 1 },
  { up: "two", down: null },
  Object.create({ hidden: 4 }, { shown: { value: 5, enumerable: true }, kept: { value: 6 } }),
];
for (var place = 0, size = tables.length; place < size; place++) {
  var module = tables[place];
  Object.keys(module).forEach(function (name) {
    exports[name + place] = module[name];
  });
}
for (var name in exports) {
  var require = exports[name];
  exports["kind of " + name] = typeof require;
}
console.log(Object.keys(exports).sort().join());
console.log(exports.right0(4), exports.up1, exports.shown2, String(exports.kept2), exports["kind of down1"], typeof module, module === tables[2], place);
module.late = "stored on the last table";
console.log(tables[2].late, exports.late, Object.keys(exports).length);
