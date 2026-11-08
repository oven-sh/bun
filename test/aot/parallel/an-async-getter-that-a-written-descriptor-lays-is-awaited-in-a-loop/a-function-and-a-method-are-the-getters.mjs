const one = {}, two = {}, three = { kept: 1 };
Object.defineProperty(one, "ready", { get: async function () { return 4; }, enumerable: true });
Object.defineProperty(two, "ready", { async get() { return 5; }, configurable: true });
Object.defineProperty(three, "ready", { get: async () => three.kept + 5 });
for (let i = 0; i < 4; i++) console.log(await one.ready, await two.ready, await three.ready, Object.keys(one).join(), typeof Object.getOwnPropertyDescriptor(two, "ready").get);
