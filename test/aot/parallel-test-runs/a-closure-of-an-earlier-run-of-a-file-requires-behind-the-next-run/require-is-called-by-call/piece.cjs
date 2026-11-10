(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(() => require.call(null, "./leaf.cjs"));
throw new Error("gives up " + globalThis.objects.length);
