import { mock } from "bun:test";
const came = Promise.withResolvers();
mock.module("./part.js", async real => { await real(); console.log("SAID the real file came"); came.resolve(); await new Promise(() => {}); });
import("./part.js");
await came.promise;
console.log("SAID the preload ends");
