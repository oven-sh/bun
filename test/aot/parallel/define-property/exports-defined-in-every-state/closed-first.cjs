exports.a = 1;
Object.preventExtensions(exports);
try { Object.defineProperty(exports, "late", { value: 1, enumerable: true }); } catch (e) { exports.a = e.constructor.name + ": " + e.message; }
