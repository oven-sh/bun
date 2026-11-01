console.log("deferred begins");
Promise.resolve().then(() => console.log("job of deferred"));
export const loaded = import("./reader.mjs").then(() => "loaded", error => "rejected " + error.name);
console.log("deferred ends");
