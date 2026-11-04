import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
function read() { return storage.getStore(); }
let text = String(read());
for (let i = 0; i < 3; i++) text += storage.run({ i }, () => read().i + String(storage.exit(read)));
await storage.run("outer", async () => { await null; text += read(); await storage.run("inner", async () => { await null; text += read(); }); text += read(); });
console.log(text, read());
