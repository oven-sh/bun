exports.z = 1; exports.b = undefined; exports[1] = "one"; exports.a = { deep: true }; exports[Symbol.for("s")] = 1;
Object.defineProperty(exports, "hidden", { value: 1 });
