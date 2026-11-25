queueMicrotask(() => { (globalThis.order ??= []).push("job"); globalThis.late = import("./ring-b.mjs").then(m => "late " + m.b()); });
(globalThis.order ??= []).push("first");
exports.x = 1;
