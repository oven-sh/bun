// A CommonJS file that the loader runs for an import() calls import() without a store of AsyncLocalStorage, and enters a store behind the call. The text of what it asks for comes in a later turn, where the call is made again: the module reads no store, and its then() is asked under what the module entered.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.als = new AsyncLocalStorage();
globalThis.see = label => console.log(label, als.getStore());
als.run("warm-up", () => see("main inside run()"));
const root = await import("./root.mjs");
see("main goes on with " + root.name);
see("first: " + (await globalThis.first));
see("main ends");
