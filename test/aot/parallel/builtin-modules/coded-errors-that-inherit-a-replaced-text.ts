// An error that a module of the library makes with a code of which Node has no NodeError, once the program has replaced Error.prototype.toString: its text is what the new function returns. A NodeError still prints its code.
import { EventEmitter, on } from "node:events";
import tls from "node:tls";
function show(label: string, e: any) {
  console.log(label, e.name, e.code, String(e), e.toString(), `${e}`, typeof e.toString(), e.toString === Error.prototype.toString);
}
function attempt(label: string, run: () => unknown) {
  try { console.log(label, "answered", run()); } catch (e) { show(label, e); }
}
let calls = 0;
Error.prototype.toString = function () { calls++; return 7 as any; };
attempt("abort", () => on(new EventEmitter(), "x", { signal: AbortSignal.abort() }));
attempt("method", () => tls.createSecureContext({ secureProtocol: "nope" }));
attempt("ciphers", () => tls.createServer({ ciphers: "nope" }));
attempt("listener", () => new EventEmitter().on("x", 1 as any));
console.log("calls", calls);
