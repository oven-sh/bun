(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(() => { try { return require("./piece.cjs"); } catch (e) { return e.message; } });
throw new Error("gives up " + globalThis.objects.length);
