store.run("inner", () => import("./late.cjs")).then(late => see("late is loaded: " + late.default.name));
see("asks");
exports.name = "asks";
