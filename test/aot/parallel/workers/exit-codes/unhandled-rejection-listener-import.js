process.on("unhandledRejection", reason => postMessage("listener: " + reason.message));
await import("./rejects.js");
postMessage("after import");
