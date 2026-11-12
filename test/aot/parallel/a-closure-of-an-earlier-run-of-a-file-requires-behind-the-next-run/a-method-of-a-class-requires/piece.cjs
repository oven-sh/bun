(globalThis.objects ??= []).push(module);
class Loader { load() { return require("./leaf.cjs"); } }
(globalThis.laters ??= []).push(() => new Loader().load());
throw new Error("gives up " + globalThis.objects.length);
