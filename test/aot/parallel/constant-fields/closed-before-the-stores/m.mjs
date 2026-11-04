const E = {};
Object.preventExtensions(E);
try { E.A = 0; } catch (e) { console.log("refused", e.name); }
export const read = () => String(E.A);
