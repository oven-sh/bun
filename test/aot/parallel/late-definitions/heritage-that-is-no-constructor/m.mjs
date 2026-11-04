const notOne = () => 1;
let B;
try { B = class extends notOne {}; } catch (e) { console.log("at the declaration:", e.name); }
export const read = () => B;
