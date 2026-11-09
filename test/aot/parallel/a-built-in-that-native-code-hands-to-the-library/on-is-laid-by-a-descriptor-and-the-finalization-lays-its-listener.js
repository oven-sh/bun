Object.defineProperty(process, "on", { value(event) { console.log(event, typeof this.allowedNodeEnvironmentFlags.has); return this; }, configurable: true });
process.finalization.register({}, () => {});
