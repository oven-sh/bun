import { AsyncLocalStorage } from "node:async_hooks";
const out: string[] = [];
let storage: AsyncLocalStorage<number> | undefined;
async function leaf(n: number) { await n; if (n === 3) { storage ??= new AsyncLocalStorage(); storage.enterWith(42); } out.push("leaf " + n + " " + storage?.getStore()); return n; }
async function middle(n: number) { const x = await leaf(n); out.push("middle " + n + " " + storage?.getStore()); const y = await leaf(n + 1); out.push("middle " + n + " " + storage?.getStore()); return x + y; }
async function top(n: number) { const x = await middle(n); out.push("top " + n + " " + storage?.getStore()); return x; }
async function main() {
  await 0;
  for (let i = 0; i < 6; i++) out.push("main " + (await top(i)) + " " + storage?.getStore());
  await storage!.run(7, async () => { for (let i = 0; i < 4; i++) out.push("run " + (await top(i)) + " " + storage?.getStore()); });
  out.push("end " + storage?.getStore());
}
await main();
out.push("module " + storage?.getStore());
console.log(out.join("\n"));
