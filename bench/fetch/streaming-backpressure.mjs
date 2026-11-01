// Streaming/backpressure benchmark for fetch bodies. Runs under bun or node.
//
//   [MB=64] [STALL=0] [CONCURRENCY=1] bun bench/fetch/streaming-backpressure.mjs <scenario>
//
// scenarios: fetch-to-fetch | readable-body | download-proxy
// prints one JSON line: elapsedMs, peakRssMB (sampled), cpuMs, per-run totals.
// All servers are in-process net/http servers on loopback, so the numbers are
// the runtime's own overhead moving MB-per-stream x CONCURRENCY streams.
// STALL>0 pauses the consumer that long before draining (rate-mismatch case).
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const scenario = process.argv[2];
const MB = Number(process.env.MB ?? 64), STALL = Number(process.env.STALL ?? 0), C = Number(process.env.CONCURRENCY ?? 1);
const CHUNK = Buffer.alloc(64 * 1024, 0x47), COUNT = MB * 16, TOTAL = CHUNK.length * COUNT;
const rt = typeof Bun !== "undefined" ? "bun " + Bun.version_with_sha : "node " + process.version;

let peak = 0;
const rssNow = () => (process.memoryUsage.rss ? process.memoryUsage.rss() : process.memoryUsage().rss);
const sampler = setInterval(() => { const r = rssNow(); if (r > peak) peak = r; }, 10);
const t0 = Date.now(), cpu0 = process.cpuUsage();
setTimeout(() => { console.log(JSON.stringify({ scenario, MB, STALL, C, runtime: rt, TIMEOUT: true, peakRssMB: Math.round(peak / 1048576) })); process.exit(1); }, 300000).unref();

async function makeSource() {
  const srv = net.createServer(sock => {
    sock.write("HTTP/1.1 200 OK\r\ncontent-length: " + TOTAL + "\r\nconnection: close\r\n\r\n");
    let n = 0;
    const pump = () => { while (n < COUNT) { n++; if (!sock.write(CHUNK)) return sock.once("drain", pump); } sock.end(); };
    pump();
    sock.on("error", () => {});
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() };
}
async function makeSlowSink() {
  let done; const drained = new Promise(r => (done = r));
  const srv = net.createServer(sock => {
    let got = 0; if (STALL) { sock.pause(); setTimeout(() => sock.resume(), STALL); }
    sock.on("data", d => { got += d.length; if (got >= TOTAL) done(got); });
    sock.on("error", () => {});
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, drained, close: () => srv.close() };
}

async function fetchToFetch() {
  const source = await makeSource(), sink = await makeSlowSink();
  const up = await fetch(source.url);
  fetch(sink.url, { method: "POST", body: up.body, duplex: "half" }).catch(() => {});
  await sink.drained; source.close(); sink.close();
}
async function readableBody() {
  const sink = await makeSlowSink();
  const body = Readable.from((function* () { for (let i = 0; i < COUNT; i++) yield CHUNK; })());
  fetch(sink.url, { method: "POST", body, duplex: "half" }).catch(() => {});
  await sink.drained; sink.close();
}
async function downloadProxy() {
  const source = await makeSource();
  const server = http.createServer(async (req, res) => {
    const up = await fetch(source.url);
    res.writeHead(200);
    await pipeline(Readable.fromWeb(up.body), res).catch(() => {});
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  await new Promise(resolve => {
    let got = 0;
    const c = net.connect(server.address().port, "127.0.0.1", () => { if (STALL) { c.pause(); setTimeout(() => c.resume(), STALL); } c.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"); });
    c.on("data", d => { got += d.length; if (got >= TOTAL) { c.destroy(); resolve(); } });
    c.on("error", () => {});
  });
  server.close(); source.close();
}
const table = { "fetch-to-fetch": fetchToFetch, "readable-body": readableBody, "download-proxy": downloadProxy };
const fn = table[scenario];
if (!fn) { console.error("scenarios:", Object.keys(table).join(" ")); process.exit(2); }
await Promise.all(Array.from({ length: C }, (_, i) => fn(i)));
clearInterval(sampler);
const cpu = process.cpuUsage(cpu0);
console.log(JSON.stringify({ scenario, MB, STALL, C, totalGB: +(TOTAL * C / 2**30).toFixed(2), runtime: rt, elapsedMs: Date.now() - t0, peakRssMB: Math.round(peak / 1048576), cpuMs: Math.round((cpu.user + cpu.system) / 1000) }));
process.exit(0);
