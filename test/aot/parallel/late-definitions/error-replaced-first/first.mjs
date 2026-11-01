export const real = globalThis.Error;
try { globalThis.Error = class Fake { fake = true; }; } catch (e) { console.log("refused", e.name); }
