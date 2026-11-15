const flags = {};
Object.defineProperty(flags, "ready", { async get() { return 5; }, configurable: true });
for (let i = 0; i < 4; i++) console.log(await flags.ready);
