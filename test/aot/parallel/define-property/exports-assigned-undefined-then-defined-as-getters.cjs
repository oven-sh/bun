// What TypeScript emits for `export { x } from`: every name is first assigned undefined, then defined as a getter.
Object.defineProperty(exports, "__esModule", { value: true });
exports.last = exports.third = exports.second = exports.first = void 0;
const source = { first: 1, second: "two", third: [3], last: () => 4 };
const seen = [];
function look(when) {
  seen.push(when + ": " + Object.keys(exports).join() + " | " + Reflect.ownKeys(exports).join() + " | " + JSON.stringify(exports) + " | " + Object.entries(Object.getOwnPropertyDescriptors(exports)).map(([key, d]) => key + ("get" in d ? "G" : "V") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c") + (d.writable ? "W" : "w")).join());
}
look("assigned");
Object.defineProperty(exports, "first", { enumerable: true, get: function () { return source.first; } });
look("one");
Object.defineProperty(exports, "third", { enumerable: true, get: function () { return source.third; } });
Object.defineProperty(exports, "second", { enumerable: true, get: function () { return source.second; } });
look("three");
var bind = function (o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = { enumerable: true, get: function () { return m[k]; } };
  Object.defineProperty(o, k2, desc);
};
bind(exports, source, "last");
bind(exports, source, "first", "renamed");
look("all");
source.first = 10;
source.second = "twenty";
console.log(exports.first, exports.second, exports.third, exports.last(), exports.renamed);
for (const name of ["first", "second", "renamed", "__esModule"]) {
  try {
    exports[name] = "stored";
    console.log(name, "stored without an error", exports[name]);
  } catch (error) {
    console.log(name, error.constructor.name);
  }
  try {
    Object.defineProperty(exports, name, { value: 1 });
    console.log(name, "defined again");
  } catch (error) {
    console.log(name, error.constructor.name);
  }
  console.log(name, delete exports[name], name in exports);
}
look("end");
const copy = { ...exports };
const assigned = Object.assign({}, exports);
console.log(JSON.stringify(copy), JSON.stringify(assigned), seen.join("\n"));
const again = require("./exports-assigned-undefined-then-defined-as-getters.cjs");
console.log(again === exports, again.first);
