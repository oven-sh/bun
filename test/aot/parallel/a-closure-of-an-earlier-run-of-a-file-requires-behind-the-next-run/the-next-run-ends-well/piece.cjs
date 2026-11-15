(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(() => { require("./leaf.cjs"); return "required"; });
if (globalThis.objects.length === 1) throw new Error("gives up");
