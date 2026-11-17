const { hidden, quiet, default: value } = await import("./crate.cjs");
console.log(String(hidden), String(quiet), String(value));
