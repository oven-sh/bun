(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(() => { globalThis.leaf = undefined; return require("./leaf.json"); });
throw new Error("gives up " + globalThis.objects.length);
