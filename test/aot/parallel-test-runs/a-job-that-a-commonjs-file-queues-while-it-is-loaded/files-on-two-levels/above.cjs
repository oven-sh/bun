(globalThis.order ??= []).push("above");
queueMicrotask(() => (globalThis.jobs ??= []).push("above: behind " + globalThis.order.at(-1)));
exports.x = 1;
