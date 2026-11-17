try { require("./thrower.cjs"); } catch (error) { console.log("threw", error.message); }
console.log("main", globalThis.readThrower());
