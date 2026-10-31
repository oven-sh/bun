await import("./fine.js");
postMessage("after import");
await new Promise(() => {});
