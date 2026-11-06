// An error that a module of the library makes with a code of which Node has no NodeError: its text is what Error.prototype.toString answers. A NodeError prints its code.
import { EventEmitter, on } from "node:events";
import tls from "node:tls";
function show(label: string, e: any) {
  console.log(label, e.name, e.code, String(e), e.toString(), `${e}`, e.toString === Error.prototype.toString,
    Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(e), "toString"));
}
function attempt(label: string, run: () => unknown) {
  try { console.log(label, "answered", run()); } catch (e) { show(label, e); }
}
attempt("abort", () => on(new EventEmitter(), "x", { signal: AbortSignal.abort() }));
attempt("method", () => tls.createSecureContext({ secureProtocol: "nope" }));
attempt("ciphers", () => tls.createServer({ ciphers: "nope" }));
attempt("listener", () => new EventEmitter().on("x", 1 as any));
