import { AsyncLocalStorage } from "node:async_hooks";
globalThis.als = new AsyncLocalStorage(); globalThis.log = []; als.run("w", () => {});
als.enterWith("main");
const first = await import("./steps.mjs");
log.push("main " + String(als.getStore()), first.seen.join(","));
console.log(log.join("\n"));
