const { hidden } = await import("./crate.cjs");
console.log(typeof hidden, typeof hidden === "function" && hidden());
