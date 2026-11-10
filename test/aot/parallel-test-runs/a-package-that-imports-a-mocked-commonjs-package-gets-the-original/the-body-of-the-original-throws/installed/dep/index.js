globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.value = () => "real";
throw new Error("the body of dep throws");
