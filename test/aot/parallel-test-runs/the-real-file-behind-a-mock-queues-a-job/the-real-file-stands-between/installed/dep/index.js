(globalThis.order ??= []).push("dep");
queueMicrotask(() => (globalThis.jobs ??= []).push("dep: behind " + globalThis.order.at(-1)));
exports.value = () => "real";
