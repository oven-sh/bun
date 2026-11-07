process.on("exit", code => console.log("exit-listener-import.js: exit listener", code, process.exitCode));
await import("./rejects.js");
postMessage("after import");
