Object.defineProperty(process, "once", { value() { return "defined"; }, configurable: true, writable: true });
console.log(process.once("x", () => {}));
console.log(Reflect.set(process, "prependListener", () => "set"), process.prependListener());
Object.assign(process, { eventNames() { return ["assigned"]; } });
console.log(process.eventNames().join());
