const first = await import("./ledger.cjs", { with: { type: "bytes" } });
const pending = import("./ledger.cjs", { with: { type: "file" } });
const again = await import("./ledger.cjs", { with: { type: "bytes" } });
const required = import.meta.require("./ledger.cjs", { type: "bytes" });
console.log(Object.keys(first).join(), Object.keys(again).join(), first === again, required.red);
await pending;
