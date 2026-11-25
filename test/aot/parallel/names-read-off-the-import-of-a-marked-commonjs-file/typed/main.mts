const { shown, default: value }: { shown?: number; default?: number } = await import("./crate.cjs");
console.log(String(shown), String(value));
