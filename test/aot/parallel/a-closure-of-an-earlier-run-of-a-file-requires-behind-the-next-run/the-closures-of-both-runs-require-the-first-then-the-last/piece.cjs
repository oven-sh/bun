(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(() => { require("./leaf.cjs"); return "required"; });
throw new Error("gives up " + globalThis.objects.length);
