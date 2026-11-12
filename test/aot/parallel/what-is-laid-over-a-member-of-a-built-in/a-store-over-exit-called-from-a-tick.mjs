process.exit = function (code) { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); };
process.nextTick(() => { process.exit(0); });
