(globalThis.order ??= []).push("second");
queueMicrotask(() => (globalThis.jobs ??= []).push("second: behind " + globalThis.order.at(-1)));
exports.x = 1;
