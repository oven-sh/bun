import "./south.mjs";
let none = 0;
for (let turn = 0; turn < 300; turn++) if (globalThis.listed() === "none") none++;
export const seen = none;
