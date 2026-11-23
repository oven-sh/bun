const { createHook } = require("node:async_hooks");
const said = [];
const hook = createHook({ init(id, type, trigger, tick) { if (type === "TickObject" && tick.args) tick.args[0] = "laid"; } }).enable();
process.nextTick(first => said.push(typeof first, first), 1);
process.nextTick((a, b, c, d) => said.push(a + b + c + d), 1, 2, 3, 4);
hook.disable();
setTimeout(() => console.log(said.join(" ")), 1);
