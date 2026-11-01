process.exitCode = 5;
await import("./rejects.js");
postMessage("after import");
