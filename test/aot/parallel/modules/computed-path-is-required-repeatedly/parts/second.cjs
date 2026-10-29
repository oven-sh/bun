globalThis.loadedParts = (globalThis.loadedParts ?? 0) + 1;
module.exports = { name: "second", loaded: globalThis.loadedParts, asked: 0 };
