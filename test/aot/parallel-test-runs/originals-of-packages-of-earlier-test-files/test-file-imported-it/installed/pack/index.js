console.log("SAID body of dep");
globalThis.count = (globalThis.count ?? 0) + 1;
exports.flag = "real" + globalThis.count; exports.plain = "real"; exports.fn = () => "fn" + exports.flag;
