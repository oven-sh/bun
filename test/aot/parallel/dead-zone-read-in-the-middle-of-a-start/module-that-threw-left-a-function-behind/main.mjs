try { await import("./thrower.mjs"); } catch (error) { console.log("threw", error.message); }
console.log("main", globalThis.readThrower());
