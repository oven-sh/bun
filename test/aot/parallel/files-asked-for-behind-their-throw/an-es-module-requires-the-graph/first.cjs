console.log("first runs");
exports.first = 1;
if (globalThis.seen === undefined) throw new Error("first threw");
