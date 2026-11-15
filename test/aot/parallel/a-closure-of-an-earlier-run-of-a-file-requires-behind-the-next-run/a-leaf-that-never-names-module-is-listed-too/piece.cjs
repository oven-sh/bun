(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(() => { require("./spare.cjs"); return require("./leaf.cjs"); });
throw new Error("gives up " + globalThis.objects.length);
