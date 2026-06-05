// Default Electron behavior: app quits when the last window closes.
import { app, BrowserWindow } from "../../src/index.ts";

app.on("before-quit", () => console.log("before-quit"));
app.on("will-quit", () => console.log("will-quit"));
app.on("quit", () => console.log("quit"));

await app.whenReady();
const win = new BrowserWindow({ width: 320, height: 240, show: false });
await win.loadURL("data:text/html,<body>bye</body>");
console.log("window-loaded");
win.close();
