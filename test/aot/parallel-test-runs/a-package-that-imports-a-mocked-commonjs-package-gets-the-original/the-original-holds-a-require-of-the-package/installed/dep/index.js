(globalThis.order ??= []).push("dep");
exports.value = () => "real";
exports.other = () => "real other";
exports.late = () => require("reads");
