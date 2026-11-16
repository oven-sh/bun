queueMicrotask(() => (globalThis.order ??= []).push("job"));
(globalThis.order ??= []).push("first");
exports.x = 1;
