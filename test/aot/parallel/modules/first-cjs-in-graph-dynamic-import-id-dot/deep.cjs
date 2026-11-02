const who = m => (m === undefined ? "undefined" : m === null ? "null" : m.id === "." ? "." : require("node:path").basename(m.filename));
console.log("deep: parent", who(module.parent), "id", module.id === "." ? "." : require("node:path").basename(module.id), "main", require.main === module);
