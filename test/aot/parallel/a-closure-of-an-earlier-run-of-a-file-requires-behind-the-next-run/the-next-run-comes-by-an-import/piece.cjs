(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(() => require("./leaf.cjs"));
throw new Error("gives up " + globalThis.objects.length);
