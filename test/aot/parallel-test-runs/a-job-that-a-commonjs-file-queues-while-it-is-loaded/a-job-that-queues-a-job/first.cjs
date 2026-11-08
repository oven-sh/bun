(globalThis.order ??= []).push("first");
queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => (globalThis.jobs ??= []).push("first: behind " + globalThis.order.at(-1)))));
exports.x = 1;
