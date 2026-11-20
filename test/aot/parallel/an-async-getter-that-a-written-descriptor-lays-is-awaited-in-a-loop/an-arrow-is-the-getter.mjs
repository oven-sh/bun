const flags = {};
Object.defineProperty(flags, "ready", { get: async () => 3 });
for (let i = 0; i < 3; i++) console.log(await flags.ready);
