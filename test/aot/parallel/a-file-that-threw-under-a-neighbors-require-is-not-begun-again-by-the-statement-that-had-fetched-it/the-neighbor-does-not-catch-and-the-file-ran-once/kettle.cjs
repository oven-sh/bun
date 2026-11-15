globalThis.boils = (globalThis.boils ?? 0) + 1;
console.log("kettle begins, time", globalThis.boils);
if (globalThis.boils === 1) throw new Error("the kettle is dry");
exports.water = "of time " + globalThis.boils;
