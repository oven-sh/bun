export const real = globalThis.Date;
try { globalThis.Date = class Fake { fake = true; }; } catch (e) { console.log("refused", e.name); }
