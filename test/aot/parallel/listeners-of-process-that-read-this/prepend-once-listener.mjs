process.prependOnceListener("exit", function () { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); });
