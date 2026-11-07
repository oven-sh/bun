import { test } from "bun:test"; import { AsyncLocalStorage } from "node:async_hooks";
let als; test("enters", async () => { await 0; als = new AsyncLocalStorage(); als.enterWith("in"); });
test("next", async () => { const here = String(als.getStore()); await new Promise(done => setTimeout(done, 1)); console.log("| " + here + " " + als.getStore()); });
