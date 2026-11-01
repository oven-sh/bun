// close, error, respond and releaseLock answer undefined; cancel answers a promise of undefined.
let kept; const stream = new ReadableStream({ type: "bytes", start(c) { kept = c; }, pull(c) { const r = c.byobRequest; if (r) { r.view[0] = 7; console.log("respond:", r.respond(1)); } } });
const reader = stream.getReader({ mode: "byob" });
function read() { return reader.read(new Uint8Array(2)); }
const got = await read(); console.log(got.value[0], got.done);
function release() { return reader.releaseLock(); }
console.log("releaseLock:", release());
function close() { return kept.close(); }
console.log("close:", close());
const other = new ReadableStream({ type: "bytes", start(c) { console.log("error:", c.error(new Error("x"))); } });
const second = new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" });
function cancel() { return second.cancel("why"); }
console.log(cancel() instanceof Promise, await cancel());
