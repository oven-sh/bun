const kit = await import("./index.mjs");
console.log(kit.size);
if (process.env.MADE_UP_NEVER) await import("./fn.cjs");
