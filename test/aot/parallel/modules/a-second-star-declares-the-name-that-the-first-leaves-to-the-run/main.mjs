const say = async (what, load) => { try { console.log("SAID", what, String((await load()).look())); } catch (error) { console.log("SAID", what, error.name); } };
await say("space", () => import("./space.mjs"));
await say("named", () => import("./named.mjs"));
console.log("SAID ran", (globalThis.ran ?? []).toSorted().join());
