process.once("exit", () => {});
process.on = function (event) { console.log(event, typeof this.allowedNodeEnvironmentFlags.has); return this; };
process.finalization.register({}, () => {});
