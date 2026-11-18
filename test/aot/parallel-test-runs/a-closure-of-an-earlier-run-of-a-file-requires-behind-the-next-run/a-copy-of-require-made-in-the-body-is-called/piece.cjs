(globalThis.objects ??= []).push(module);
const ask = require;
(globalThis.laters ??= []).push(() => ask("./leaf.cjs"));
throw new Error("gives up " + globalThis.objects.length);
