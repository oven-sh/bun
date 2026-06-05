// app.quit() exits the process and fires lifecycle events in order.
import { app } from "../../src/index.ts";

const order = [];
app.on("before-quit", () => order.push("before-quit"));
app.on("will-quit", () => order.push("will-quit"));
app.on("quit", () => {
  order.push("quit");
  console.log(order.join(","));
});

await app.whenReady();
console.log("ready");
app.quit();
