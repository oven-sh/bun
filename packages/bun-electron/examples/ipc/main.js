import { app, BrowserWindow, ipcMain } from "../../src/index.ts";

ipcMain.handle("ping", (event, value) => {
  return `pong: ${value}`;
});

ipcMain.on("log", (event, message) => {
  console.log("renderer says:", message);
  event.reply("log-reply", "got it");
});

await app.whenReady();

const win = new BrowserWindow({ width: 700, height: 500, title: "IPC demo" });

await win.loadURL(
  "data:text/html," +
    encodeURIComponent(`<!doctype html>
<html><body style="font-family: system-ui"><h1>IPC demo</h1><pre id="out"></pre>
<script>
  const out = document.getElementById("out");
  ipcRenderer.on("log-reply", (event, msg) => { out.textContent += "main replied: " + msg + "\\n"; });
  ipcRenderer.send("log", "hello from the renderer");
  ipcRenderer.invoke("ping", 42).then((result) => { out.textContent += "invoke result: " + result + "\\n"; });
</script></body></html>`),
);
