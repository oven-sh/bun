// node:zlib is handed to listeners, callbacks and stores of the library. What they get is used under computed names.
import * as zlib from "node:zlib";
import { EventEmitter, once } from "node:events";
import { AsyncLocalStorage } from "node:async_hooks";
import { promisify } from "node:util";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const show = api => console.log(api[hide("gunzipSync")](api[hide("gzipSync")]("hello")).toString());
const emitter = new EventEmitter();
emitter.on("x", show);
const waiting = once(emitter, "x");
emitter.emit("x", zlib);
show((await waiting)[0]);
const storage = new AsyncLocalStorage();
storage.run(zlib, () => show(hide(storage).getStore()));
show(await promisify(callback => callback(null, zlib))());
