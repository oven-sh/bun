import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
const b = await import("./b.mjs"); console.log("main", s(), b.left);
