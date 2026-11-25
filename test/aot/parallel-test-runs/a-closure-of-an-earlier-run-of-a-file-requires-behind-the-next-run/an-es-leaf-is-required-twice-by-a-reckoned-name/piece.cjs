(globalThis.objects ??= []).push(module);
(globalThis.laters ??= []).push(name => require(name));
throw new Error("gives up " + globalThis.objects.length);
