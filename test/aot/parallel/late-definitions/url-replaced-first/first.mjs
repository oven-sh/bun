export const real = globalThis.URL;
try { globalThis.URL = class Fake { fake = true; }; } catch (e) { console.log("refused", e.name); }
