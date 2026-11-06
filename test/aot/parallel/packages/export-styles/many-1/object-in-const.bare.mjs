import "s_object_in_const";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
