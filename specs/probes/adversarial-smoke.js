const log = (...a) => console.log(...a);
process.on("unhandledRejection", (e) => log("UNHANDLED_REJECTION ::", String(e)));
process.on("uncaughtException", (e) => log("UNCAUGHT ::", String(e && e.stack || e)));
const withTimeout = (name, p, ms = 3000) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error("STEP_TIMEOUT " + name)), ms))]);
const steps = {
  "1-error-propagation": async () => { const err = new Error("boom"); const s = new ReadableStream({ pull() { throw err; } }); try { await s.getReader().read(); return "no-throw"; } catch (e) { return e === err ? "OK" : "wrong:" + e; } },
  "2-release-pending-read": async () => { const s = new ReadableStream({ pull() {} }); const r = s.getReader(); const p = r.read(); r.releaseLock(); try { await p; return "resolved"; } catch (e) { return e instanceof TypeError ? "OK" : "wrong:" + e; } },
  "3-relock-after-release": async () => { const s = new ReadableStream({ pull() {} }); const r = s.getReader(); r.releaseLock(); s.getReader(); return "OK"; },
  "4-pipeTo-abort-both": async () => { let cancelled = 0, aborted = 0; const ac = new AbortController(); const src = new ReadableStream({ pull(c) { c.enqueue("x"); }, cancel() { cancelled = 1; } }); const dst = new WritableStream({ write() { ac.abort(new Error("stop")); return new Promise(r => setTimeout(r, 0)); }, abort() { aborted = 1; } }); try { await src.pipeTo(dst, { signal: ac.signal }); return "resolved"; } catch (e) { return (aborted && cancelled) ? "OK" : `aborted=${aborted} cancelled=${cancelled}`; } },
  "5-direct-response-text": async () => { const d = new ReadableStream({ type: "direct", pull(ctrl) { ctrl.write("di"); ctrl.write("rect"); ctrl.end(); } }); const t = await new Response(d).text(); return t === "direct" ? "OK" : "got:" + t; },
  "6-byob-respond": async () => { const s = new ReadableStream({ type: "bytes", pull(c) { const v = c.byobRequest.view; new Uint8Array(v.buffer, v.byteOffset, v.byteLength)[0] = 7; c.byobRequest.respond(1); } }); const { value } = await s.getReader({ mode: "byob" }).read(new Uint8Array(3)); return (value[0] === 7 && value.byteLength === 1) ? "OK" : "got:" + value; },
  "7-for-await-break": async () => { let c = null; const s = new ReadableStream({ start(x) { x.enqueue(1); x.enqueue(2); }, cancel() { c = 1; } }); for await (const v of s) break; return c ? "OK" : "cancel-not-called"; },
  "8-tee-one-cancels": async () => { const s = new ReadableStream({ start(c) { c.enqueue("a"); c.enqueue("b"); c.close(); } }); const [x, y] = s.tee(); y.cancel(); const t = await Bun.readableStreamToText(x); return t === "ab" ? "OK" : "got:" + t; },
  "9-transform-flush": async () => { const t = new TransformStream({ transform(c, ctl) { ctl.enqueue(c.toUpperCase()); }, flush(ctl) { ctl.enqueue("!"); } }); const w = t.writable.getWriter(); w.write("hi"); w.close(); const out = await Bun.readableStreamToText(t.readable); return out === "HI!" ? "OK" : "got:" + out; },
  "10-writer-error-prop": async () => { const errs = []; const w = new WritableStream({ write() { throw new Error("sinkfail"); } }); const wr = w.getWriter(); try { await wr.write("x"); return "write-resolved"; } catch { errs.push(1); } try { await wr.closed; } catch { errs.push(2); } return errs.length === 2 ? "OK" : "got:" + errs; },
};
let failures = 0;
for (const [name, fn] of Object.entries(steps)) {
  let r; try { r = await withTimeout(name, fn()); } catch (e) { r = "THREW:" + e; }
  if (r !== "OK") failures++;
  log((r === "OK" ? "OK   " : "FAIL ") + name + (r === "OK" ? "" : " -> " + r));
}
await new Promise(r => setTimeout(r, 50));
log(failures ? "VERIFY_FAIL " + failures : "VERIFY_PASS");
