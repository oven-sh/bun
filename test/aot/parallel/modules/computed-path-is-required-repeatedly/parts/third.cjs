globalThis.loadedParts = (globalThis.loadedParts ?? 0) + 1;
module.exports = { name: "third", loaded: globalThis.loadedParts, asked: 0 };
