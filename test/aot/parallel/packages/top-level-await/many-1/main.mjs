// Loads one program after another. Each imports a package of its own in one way.
console.log("## top-level-await.order.mjs");
await import("./top-level-await.order.mjs");
console.log("## top-level-await.value.mjs");
await import("./top-level-await.value.mjs");
console.log("## top-level-await.rejects_dyn.mjs");
await import("./top-level-await.rejects_dyn.mjs");
console.log("## top-level-await.for_await.mjs");
await import("./top-level-await.for_await.mjs");
console.log("## top-level-await.in_block.mjs");
await import("./top-level-await.in_block.mjs");
console.log("## top-level-await.dyn_in_tla.mjs");
await import("./top-level-await.dyn_in_tla.mjs");
console.log("## top-level-await.using.mjs");
await import("./top-level-await.using.mjs");
console.log("## top-level-await.entry_tla.mjs");
await import("./top-level-await.entry_tla.mjs");
