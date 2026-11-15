(globalThis.order ??= []).push("third");
queueMicrotask(() => (globalThis.jobs ??= []).push("third: behind " + globalThis.order.at(-1)));
exports.x = 1;
