let n = 0;
function __export(target, all) { for (var name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true }); }
__export(Event.prototype, { count: () => ++n });
new CustomEvent("x").count; new MessageEvent("y").count;
console.log(`${n}`);
