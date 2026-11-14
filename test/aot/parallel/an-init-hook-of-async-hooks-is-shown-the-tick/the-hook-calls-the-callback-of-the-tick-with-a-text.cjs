const { createHook } = require("node:async_hooks");
function told(count) { console.log(typeof count, count); }
createHook({ init(id, type, trigger, tick) { if (type === "TickObject") { const callback = tick.callback; callback("by the hook"); } } }).enable();
process.nextTick(told, 7);
