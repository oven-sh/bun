export const refused = Object.freeze(new Proxy({ size: 1 }, { preventExtensions() { return false; } }));
