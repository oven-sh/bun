(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(async () => { await null; return require("./leaf.cjs"); });
throw new Error("gives up " + globalThis.objects.length);
