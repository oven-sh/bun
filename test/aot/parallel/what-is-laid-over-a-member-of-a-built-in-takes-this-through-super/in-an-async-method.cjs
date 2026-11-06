Object.defineProperty(process, "umask", { async value() { return super.valueOf(); }, configurable: true });
process.umask().then(held => console.log(held === process, typeof held.allowedNodeEnvironmentFlags));
