class Config { constructor() { this.level = 3; this.hooks = [() => "a hook"]; } get doubled() { return this.level * 2; } }
globalThis.__printedAndCopied = new Config();
console.log(globalThis.__printedAndCopied, JSON.stringify(globalThis.__printedAndCopied), structuredClone({ level: globalThis.__printedAndCopied.level }));
console.log(Object.assign({}, globalThis).__printedAndCopied.hooks[0](), { ...globalThis }.__printedAndCopied.doubled);
