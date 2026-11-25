function heard() { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); }
process.on("exit", heard);
