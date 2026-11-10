const both = await Promise.allSettled([import("./fresh.js"), import("./gate.cjs")]);
console.log(both.map((r) => r.status).join());
