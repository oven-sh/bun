import "./g.mjs";
await Promise.reject(new Error("awaited in f"));
