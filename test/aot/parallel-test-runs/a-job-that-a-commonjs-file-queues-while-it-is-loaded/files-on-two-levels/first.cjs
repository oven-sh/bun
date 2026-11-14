(globalThis.order ??= []).push("first");
queueMicrotask(() => (globalThis.jobs ??= []).push("first: behind " + globalThis.order.at(-1)));
exports.x = 1;
