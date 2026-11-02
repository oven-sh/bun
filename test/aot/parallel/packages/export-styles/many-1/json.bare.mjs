import "s_json";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
