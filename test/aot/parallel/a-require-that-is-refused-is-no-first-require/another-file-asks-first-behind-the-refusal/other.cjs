globalThis.runs.push(module);
const ask = () => { try { require("./leaf.mjs"); return "answered"; } catch (error) { return error.name; } };
exports.later = () => console.log("SAID other", ask(), module.children.length);
