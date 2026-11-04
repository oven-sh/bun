export const real = globalThis.Promise;
try { globalThis.Promise = class Fake { fake = true; }; } catch (e) { console.log("refused", e.name); }
