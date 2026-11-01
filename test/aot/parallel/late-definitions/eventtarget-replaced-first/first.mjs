export const real = globalThis.EventTarget;
try { globalThis.EventTarget = class Fake { fake = true; }; } catch (e) { console.log("refused", e.name); }
