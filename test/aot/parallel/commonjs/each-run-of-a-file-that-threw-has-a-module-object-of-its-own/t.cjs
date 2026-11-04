(globalThis.modules ??= []).push(module);
(globalThis.allExports ??= []).push(exports);
(globalThis.receivers ??= []).push(this);
(globalThis.requires ??= []).push(require);
exports.runs = (exports.runs ?? 0) + 1;
if (!globalThis.succeed) throw new Error("run " + globalThis.modules.length);
