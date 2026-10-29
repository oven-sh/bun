process.on("uncaughtException", (error, origin) => postMessage("listener: " + error.message + ", " + origin));
await import("./rejects.js");
postMessage("after import");
