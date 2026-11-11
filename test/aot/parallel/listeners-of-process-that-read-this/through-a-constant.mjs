const held = process;
held.on("exit", function () { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); });
