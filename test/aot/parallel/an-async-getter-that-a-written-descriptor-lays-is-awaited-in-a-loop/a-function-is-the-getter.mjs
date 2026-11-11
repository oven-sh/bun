const flags = {};
Object.defineProperty(flags, "ready", { get: async function () { return 4; }, enumerable: true });
for (let i = 0; i < 4; i++) console.log(await flags.ready);
