globalThis.loadedParts = (globalThis.loadedParts ?? 0) + 1;
module.exports = { name: "first", loaded: globalThis.loadedParts, asked: 0 };
