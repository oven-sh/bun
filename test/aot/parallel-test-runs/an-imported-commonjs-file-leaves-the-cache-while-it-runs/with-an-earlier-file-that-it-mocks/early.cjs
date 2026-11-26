globalThis.early = (globalThis.early ?? 0) + 1;
console.log("early");
Object.assign(exports, { v: "early" + globalThis.early });
