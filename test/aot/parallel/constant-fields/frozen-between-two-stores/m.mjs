const E = {};
E.A = 0;
Object.freeze(E);
try { E.A = 1; } catch (e) { console.log("refused", e.name); }
export const read = () => String(E.A);
