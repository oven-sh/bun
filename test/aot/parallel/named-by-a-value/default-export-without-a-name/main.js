const all = await import("./tool.js");
console.log(all[globalThis.never ? "" : "default"](), new all.Named().use());
