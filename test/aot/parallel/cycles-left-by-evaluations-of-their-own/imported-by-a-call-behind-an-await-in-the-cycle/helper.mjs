const it = await import("./outside.mjs");
console.log("helper:", it.seen);
