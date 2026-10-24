const wasRequired = Boolean(module.parent);
exports.report = () => console.log("started-or-required.cjs:", wasRequired ? "required" : "started", module.parent == null);
