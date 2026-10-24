setTimeout(() => console.log("timer", globalThis.seen), 0);
await new Promise(r => setTimeout(r, 5));
const x = import.meta.require("./x.cjs");
export const v = x.v;
