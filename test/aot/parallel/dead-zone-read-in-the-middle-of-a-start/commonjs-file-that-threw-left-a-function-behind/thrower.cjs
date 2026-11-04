globalThis.readThrower = function () { try { return late.rate; } catch (error) { return error.name; } };
if (process.argv.length < 99) throw new Error("half-way");
const late = { rate: 0.2 };
