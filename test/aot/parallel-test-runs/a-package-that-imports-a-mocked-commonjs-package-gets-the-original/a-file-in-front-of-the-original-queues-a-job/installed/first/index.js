(globalThis.order ??= []).push("first");
queueMicrotask(() => globalThis.order.push("job"));
exports.x = 1;
