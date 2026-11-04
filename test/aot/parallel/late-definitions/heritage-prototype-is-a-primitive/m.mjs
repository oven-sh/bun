export function F() {}
F.prototype = 5;
let B;
try { B = class extends F {}; } catch (e) { console.log("at the declaration:", e.name); }
export const read = () => B;
