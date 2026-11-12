const { createHook } = require("node:async_hooks");
const kinds = [];
function told(count) { console.log(typeof count, count + 1, kinds.includes("TickObject")); }
createHook({ init(id, type) { kinds.push(type); } }).enable();
process.nextTick(told, 7);
