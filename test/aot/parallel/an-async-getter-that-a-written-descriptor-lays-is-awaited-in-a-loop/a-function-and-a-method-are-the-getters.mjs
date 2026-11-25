const one = {}, two = {}, three = {};
Object.defineProperty(one, "ready", { get: async function () { return 4; }, enumerable: true });
Object.defineProperty(two, "ready", { async get() { return 5; }, configurable: true });
Object.defineProperty(three, "ready", { get: async () => 6 });
for (let i = 0; i < 4; i++) console.log(await one.ready, await two.ready, await three.ready);
