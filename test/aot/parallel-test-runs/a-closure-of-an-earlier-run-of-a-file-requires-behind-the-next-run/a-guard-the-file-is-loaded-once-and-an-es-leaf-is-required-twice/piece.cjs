(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(() => require("./leaf.mjs"));
throw new Error("gives up");
