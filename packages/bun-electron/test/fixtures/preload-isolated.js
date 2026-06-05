// Preload used with contextIsolation: true.
// - A write to `window` here must stay invisible to the page.
// - `document` (read-through to the real global) must still work.
// - Only contextBridge.exposeInMainWorld crosses into the page world.
window.leakedFromPreload = "should-not-be-visible";

const hasDocument = typeof document !== "undefined";

contextBridge.exposeInMainWorld("isolatedApi", {
  answer: 42,
  add: (a, b) => a + b,
  preloadSawDocument: hasDocument,
  echo: (value) => value,
});

// Prove the preload can still talk to the main process over IPC.
ipcRenderer.send("isolated-preload-ran", "ok");
