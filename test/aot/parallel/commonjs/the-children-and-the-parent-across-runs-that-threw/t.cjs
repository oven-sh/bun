(globalThis.parents ??= []).push(module.parent);
if (!globalThis.succeed) throw new Error("boom");
