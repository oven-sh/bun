function __export(target, all) { for (var name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true }); }
__export(Event.prototype, { laid: () => "mine" });
console.log(new CustomEvent("x").laid);
