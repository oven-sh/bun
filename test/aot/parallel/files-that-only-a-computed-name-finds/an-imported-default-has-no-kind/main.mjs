const loaded = await import(process.env.MADE_UP_SETUP || "./setup.cjs");
console.log(globalThis.madeUpKind, "|", Object.keys(loaded).join(","), Object.prototype.toString.call(loaded));
