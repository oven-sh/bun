const shelf = { heard() { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); } };
process.on("exit", shelf.heard);
