// Assorted, one probe of many. It prints what plain Bun prints.
import { once, EventEmitter } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
const o = { tag: "o" };
const show = (label: string, v: unknown) => console.log(label, v === o ? "IS O" : (v as any)?.cause === o ? "cause is o" : (v as any)?.name ?? typeof v);
console.log(typeof (Promise as any).try, typeof (globalThis as any).DisposableStack, typeof (globalThis as any).SuppressedError, typeof process.setUncaughtExceptionCaptureCallback, typeof (globalThis as any).AsyncDisposableStack);
const c = new AbortController(); c.abort(o);
show("reason", c.signal.reason);
try { c.signal.throwIfAborted(); } catch (e) { show("throwIfAborted", e); }
await fetch("http://127.0.0.1:1/", { signal: c.signal }).catch(e => show("fetch", e));
await once(new EventEmitter(), "e", { signal: c.signal }).catch(e => show("once", e));
await sleep(1000, undefined, { signal: c.signal }).catch(e => show("sleep", e));
try { const s = new (globalThis as any).DisposableStack(); s.defer(() => { throw o; }); s.defer(() => { throw 5; }); s.dispose(); } catch (e: any) { console.log(e.name, e.error === o, e.suppressed === o, e.suppressed, e.error); }
try { { using x = { [Symbol.dispose]() { throw o; } }; throw 5; } } catch (e: any) { console.log("using", e.name, e.error === o, e.suppressed); }
try { await (async () => { await using x = { async [Symbol.asyncDispose]() { throw o; } }; })(); } catch (e: any) { show("await using", e); }
process.setUncaughtExceptionCaptureCallback(e => show("capture", e));
setTimeout(() => { throw o; }, 1);
await sleep(10);
process.setUncaughtExceptionCaptureCallback(null);
