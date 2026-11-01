await import("./rejects.js");
postMessage("after import");
await new Promise(() => {});
