// Preload fixture: runs before page scripts, with ipcRenderer and
// contextBridge available (bun-electron renderer bootstrap).
window.preloadExecuted = true;
window.preloadHadIpcRenderer = typeof ipcRenderer !== "undefined" && typeof ipcRenderer.send === "function";

contextBridge.exposeInMainWorld("exposedApi", {
  value: 42,
  add: (a, b) => a + b,
});

ipcRenderer.send("preload-ran", "from-preload");
