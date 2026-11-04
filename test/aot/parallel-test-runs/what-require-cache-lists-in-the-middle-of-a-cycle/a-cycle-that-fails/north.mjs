import "./south.mjs";
export const name = "north";
globalThis.said.push("in north: " + globalThis.listed());
if (Date.now() > 0) throw new Error("north fell");
