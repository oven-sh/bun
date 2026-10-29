addEventListener("unhandledrejection", () => postMessage("unhandledrejection event"));
addEventListener("error", () => postMessage("error event"));
await import("./rejects.js");
postMessage("after import");
