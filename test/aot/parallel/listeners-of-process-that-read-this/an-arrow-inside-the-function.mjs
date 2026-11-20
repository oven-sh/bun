process.on("exit", function () { const look = () => { console.log("SAID", typeof this.allowedNodeEnvironmentFlags.has); }; look(); });
