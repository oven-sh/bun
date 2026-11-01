Object.defineProperty(exports, "noGetter", { get: undefined, enumerable: true });
Object.defineProperty(exports, "noSetter", { set: undefined, configurable: true });
Object.defineProperty(exports, "neither", { get: undefined, set: undefined });
Object.defineProperty(exports, "bound", { get: function () { return this; }.bind("bound") });
Object.defineProperty(exports, "native", { get: Date.now, configurable: true });
Object.defineProperty(exports, "arrow", { get: () => typeof this, enumerable: true });
try { Object.defineProperty(exports, "bad", { get: 5 }); } catch (e) { exports.bad = e.constructor.name + ": " + e.message; }
try { Object.defineProperty(exports, "both", { get() {}, value: 1 }); } catch (e) { exports.both = e.constructor.name + ": " + e.message; }
