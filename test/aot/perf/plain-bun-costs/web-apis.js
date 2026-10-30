let sum = 0;
for (let i = 0; i < 7500; i++) { const u = new URL("https://user@example.com:8080/a/b/../c" + i + "?x=1&y=" + i + "#h"); sum += u.pathname.length + u.searchParams.get("y").length + u.href.length; }
for (let i = 0; i < 3750; i++) { const p = new URLSearchParams("a=1&b=2&c=" + i); p.append("d", "4"); p.sort(); sum += p.toString().length; }
for (let i = 0; i < 5000; i++) { const h = new Headers({ "content-type": "text/plain", "x-a": "1" }); h.set("x-b", String(i)); h.append("set-cookie", "a=1"); sum += h.get("x-b").length + [...h].length; }
for (let i = 0; i < 3750; i++) { const q = new Request("http://localhost/" + i, { method: "POST", body: "abc", headers: { a: "b" } }); const r = new Response("body" + i, { status: 201 }); sum += q.url.length + r.status; }
const encoder = new TextEncoder(), decoder = new TextDecoder(), text = "héllo wörld ✓ ".repeat(40);
for (let i = 0; i < 5000; i++) sum += decoder.decode(encoder.encode(text)).length;
for (let i = 0; i < 5000; i++) sum += atob(btoa("some binary text " + i)).length;
for (let i = 0; i < 500; i++) sum += (await new Blob(["a".repeat(100), new Uint8Array(10), "b"]).slice(5, 90).text()).length;
for (let i = 0; i < 500; i++) { const f = new FormData(); f.append("a", "1"); f.append("file", new Blob(["x"]), "x.txt"); sum += [...f.keys()].length; }
for (let i = 0; i < 500; i++) sum += (await new Response(JSON.stringify({ a: i })).json()).a;
const target = new EventTarget(); let events = 0; target.addEventListener("x", () => events++);
for (let i = 0; i < 12500; i++) target.dispatchEvent(new Event("x"));
for (let i = 0; i < 3750; i++) { const c = new AbortController(); c.signal.addEventListener("abort", () => events++); c.abort(); }
for (let i = 0; i < 150; i++) {
  const s = new ReadableStream({ start(c) { for (let k = 0; k < 100; k++) c.enqueue(encoder.encode("chunk" + k)); c.close(); } }).pipeThrough(new TransformStream({ transform(x, c) { c.enqueue(x.subarray(1)); } }));
  for await (const x of s) sum += x.length;
}
for (let i = 0; i < 37; i++) sum += (await new Response(new ReadableStream({ pull(c) { c.enqueue(encoder.encode("x".repeat(1000))); c.close(); } })).text()).length;
await new Promise(r => { let n = 0; const next = () => (++n < 20000 ? setImmediate(next) : r()); next(); });
{ let n = 0; for (let i = 0; i < 12500; i++) { const t = setTimeout(() => n++, 100000); clearTimeout(t); } sum += n; }
await new Promise(r => { let n = 0; const next = () => (++n < 200000 ? queueMicrotask(next) : r()); next(); });
await new Promise(r => { let n = 0; const next = () => (++n < 200000 ? process.nextTick(next) : r()); next(); });
for (let i = 0; i < 25000; i++) sum += performance.now() > 0 ? 1 : 0;
console.log("web-apis", sum, events);
