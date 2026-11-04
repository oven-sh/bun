Object.defineProperty(Function.prototype, "A", { set(v) { console.log("setter runs", v); }, get() { return "above"; }, configurable: true });
