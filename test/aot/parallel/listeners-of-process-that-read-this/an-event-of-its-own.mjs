process.on("madeUp", function () { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); });
process.emit("madeUp");
