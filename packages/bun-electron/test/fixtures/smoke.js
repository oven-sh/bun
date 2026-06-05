// Minimal end-to-end check: window, page load, eval, IPC round-trips, quit.
import { app, BrowserWindow, ipcMain } from "../../src/index.ts";

const timeout = setTimeout(() => {
  console.error("SMOKE TIMEOUT");
  process.exit(3);
}, 30_000);
timeout.unref?.();

ipcMain.handle("add", (event, a, b) => a + b);
ipcMain.on("hello", (event, msg) => {
  console.log("ipc-on:", msg);
  event.reply("hello-reply", "ack");
});

await app.whenReady();
console.log("ready");

const win = new BrowserWindow({ width: 640, height: 480, title: "smoke" });
win.on("closed", () => console.log("closed-event"));

await win.loadURL(
  "data:text/html," +
    encodeURIComponent(
      `<!doctype html><title>smoke-page</title><body><h1 id="h">smoke</h1><script>
        ipcRenderer.send("hello", "from-renderer");
        ipcRenderer.on("hello-reply", (e, m) => { window.__gotReply = m; });
      </script></body>`,
    ),
);
console.log("loaded");

const title = await win.webContents.executeJavaScript("document.title");
console.log("title:", title);

const sum = await win.webContents.executeJavaScript(`(async () => {
  return await ipcRenderer.invoke("add", 20, 22);
})()`);
console.log("invoke-sum:", sum);

// Wait for the reply sent through event.reply to land in the page.
let reply = null;
for (let i = 0; i < 100 && !reply; i++) {
  reply = await win.webContents.executeJavaScript("window.__gotReply ?? null");
  if (!reply) await new Promise((resolve) => setTimeout(resolve, 50));
}
console.log("reply:", reply);

console.log("bounds:", JSON.stringify(win.getBounds()));
win.close();
