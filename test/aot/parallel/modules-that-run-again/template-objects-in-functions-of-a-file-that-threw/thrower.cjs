const tag = (strings) => strings;
globalThis.count = (globalThis.count || 0) + 1;
const made = tag`x${0}y`;
globalThis.report(() => made);
if (globalThis.count < 3) throw new Error("run " + globalThis.count);
