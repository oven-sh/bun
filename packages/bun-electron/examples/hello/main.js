import { app, BrowserWindow } from "../../src/index.ts";
import path from "node:path";

await app.whenReady();

const win = new BrowserWindow({
  width: 900,
  height: 620,
  title: "Hello from bun-electron",
});

await win.loadFile(path.join(import.meta.dir, "index.html"));

const title = await win.webContents.executeJavaScript("document.title");
console.log("page title:", title);
