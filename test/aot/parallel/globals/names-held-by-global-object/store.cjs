function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
exports.Point = Point;
globalThis.heldPoint = new Point(1, 2);
globalThis.heldList = [1, 2, 3];
globalThis.heldFunction = function (n) { return n + 1; };
(function () { this.heldBySloppyThis = { n: 4 }; })();
undeclaredName = { n: 5 };
(function (root, factory) { root.heldByWrapper = factory(); })(typeof self !== "undefined" ? self : this, function () { return { n: 6, make: function (n) { return { n: n }; } }; });
exports.replace = function (way) {
  switch (way) {
  case 0: globalThis.heldPoint = { x: "text", y: 1, sum: function () { return "other"; } }; return;
  case 1: globalThis["held" + "List"] = null; return;
  case 2: Object.defineProperty(globalThis, "heldBySloppyThis", { get: function () { return { n: "got" }; }, configurable: true }); return;
  case 3: delete globalThis.undeclaredName; return;
  case 4: Object.assign(globalThis, { heldByWrapper: { n: 0.5, make: function () { return null; } } }); return;
  case 5: Reflect.set(globalThis, "neverStored", 7); return;
  case 6: delete globalThis.neverStored; return;
  case 7: for (var name of Object.keys({ lateName: 1 })) globalThis[name] = { n: 8 }; return;
  }
};
