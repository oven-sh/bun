const [x, h] = await Promise.all([import("./legacy.cjs"), import("./helper.cjs")]);
await globalThis.pending;
console.log("VALUES", x.default, "|", typeof h.default, "| back", globalThis.back);
console.log("ORDER", globalThis.order.join(" "));
