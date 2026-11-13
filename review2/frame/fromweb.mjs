import { Readable } from "node:stream";
let n = 0, calls = 0;
process.on("uncaughtException", e => console.log("uncaughtException:", e.message));
process.on("unhandledRejection", e => console.log("unhandledRejection:", e && e.message));
const rs = new ReadableStream({ async pull(c) { await new Promise(r => setTimeout(r, 30)); if (n++ < 4) c.enqueue(new TextEncoder().encode("x")); else c.close(); } });
const r = Readable.fromWeb(rs);
r.on("data", () => { calls++; if (calls === 1) throw new Error("boom"); });
r.on("end", () => console.log("end calls=" + calls));
setTimeout(() => console.log("after 1s: calls=" + calls + " (no 'end' above means the stream stalled)"), 1000);
