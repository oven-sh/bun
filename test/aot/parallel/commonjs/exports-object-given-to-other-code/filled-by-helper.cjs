function store(target, name, value) {
  target[name] = value;
  return target;
}
function define(target, name, descriptor) {
  return Object.defineProperty(target, name, descriptor);
}
exports.known = 1;
store(store(exports, "unknownOne", 2), "known", 3);
globalThis.storeLater = store;
globalThis.storeLater(exports, "unknownTwo", 4);

let received = "nothing";
store(exports, "storedEarly", "by the helper");
define(exports, "readOnly", { value: "by the helper", enumerable: true });
define(exports, "accessor", { enumerable: true, configurable: true, get: () => received, set: value => void (received = `the setter got ${value}`) });
store(exports, "__esModule", "by the helper");
store(exports, "getter", "by the helper");
define(exports, "locked", { value: "by the helper" });
exports.storedEarly = "by the body";
exports.readOnly = "by the body";
exports.accessor = "by the body";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "getter", { enumerable: true, get: function () { return exports.known; } });
try {
  Object.defineProperty(exports, "locked", { value: "by the body", enumerable: true });
} catch (error) {
  exports.definitionOfLocked = error.constructor.name;
}

(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : factory((global.library = {}));
})(this, function (exports) {
  exports.fromFactory = 6;
  Object.defineProperty(exports, "hiddenByFactory", { value: 7 });
});
exports.last = 5;
