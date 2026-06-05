// With a window-all-closed listener, the app does NOT quit automatically.
import { app, BrowserWindow } from "../../src/index.ts";

app.on("window-all-closed", () => {
  console.log("window-all-closed");
  app.quit();
});

await app.whenReady();
const win = new BrowserWindow({ width: 320, height: 240, show: false });
await win.loadURL("data:text/html,<body>bye</body>");
win.close();
