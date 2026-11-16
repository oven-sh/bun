import { AsyncLocalStorage } from "node:async_hooks";
import count from "./helper.cjs";
const als = new AsyncLocalStorage(), seen = []; als.run("warm", () => {});
async function* made(tag) { await null; als.enterWith(tag); yield 1; }
als.enterWith("top"); for await (const v of made("first")) seen.push(als.getStore());
console.log(`SAID ${seen.join(" ")} ${count()}`);
