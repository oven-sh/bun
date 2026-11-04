(globalThis.modules ??= []).push(module);
module.run = globalThis.modules.length;
(globalThis.readers ??= []).push(() => ({ module, exports }));
if (!globalThis.succeed) throw new Error("boom");
