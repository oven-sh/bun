const computed = name => "./" + name;
exports.resolveSibling = () => require.resolve("./sibling.cjs");
exports.resolveParent = () => require.resolve("../data.json");
exports.resolveComputed = name => require.resolve(computed(name));
exports.requireComputed = name => require(computed(name));
exports.importSibling = async () => (await import("./sibling.cjs")).name;
exports.importParent = async () => (await import("../esm-plain.mjs")).value;
exports.importComputed = name => import(computed(name));
