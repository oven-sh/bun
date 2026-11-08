hoisted();
function third() {
  exports.c = 3;
}
if (typeof exports === "object") {
  exports.z = (exports.y = 1) + (exports.x = 2);
  third();
}
exports.a = [(exports.b = "b"), exports.c];
exports.z = exports.z + 1;
exports.chainC = exports.chainB = exports.chainA = void 0;
[exports.fromArray, exports.fromArrayDefault = (exports.insideDefault = "default")] = ["array"];
({ p: exports.fromObject, ...exports.rest } = { p: (exports.insideSource = "object"), q: 1, r: 2 });
for (exports.loopKey in { only: 1 });
for (exports.loopValue of ["value"]);
exports.counted++;
exports.appended += "text";
exports[((exports.insideKey = "key"), "afterKey")] = exports.insideValue = "value";
delete exports.y;
exports.y = "again";
delete exports.chainB;
(function () {
  exports.inCalledFunction = 1;
})();
(() => {
  exports.inCalledArrow = 2;
})();
(async function () {
  exports.beforeAwait = 3;
  await null;
  exports.afterAwait = 4;
})();
exports.afterAsyncCall = 5;
new (function () {
  exports.inConstructor = 6;
})();
[0].forEach(() => {
  exports.inCallback = 7;
});
const generator = (function* () {
  exports.inGenerator = 8;
})();
exports.beforeGeneratorRuns = 9;
generator.next();
class Holder {
  static {
    exports.inStaticBlock = 10;
  }
  static field = (exports.inStaticField = 11);
  [((exports.inMemberName = 12), "method")]() {}
}
function withDefault(value = (exports.inParameterDefault = 13)) {}
withDefault();
const lazy = {
  get now() {
    return (exports.inGetter = 14);
  },
};
lazy.now;
const { [((exports.inPatternKey = 15), "absent")]: local = (exports.inPatternDefault = 16) } = {};
exports.aroundTemplate = `${(exports.insideTemplate = 17)}`;
function hoisted() {
  exports.inHoisted = 18;
}
