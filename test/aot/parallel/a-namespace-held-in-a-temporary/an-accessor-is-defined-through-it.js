var a; const env = (a = process) === null || a === void 0 ? void 0 : a.env;
Object.defineProperty(a, 'zz2', { get() { return typeof this.uptime(); }, configurable: true });
console.log(process.zz2);
