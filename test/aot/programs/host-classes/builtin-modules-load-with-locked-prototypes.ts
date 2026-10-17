// Bun's own modules that work with Request, Response, Blob, Headers, URL and URLSearchParams load and work while the prototypes of those classes are locked.
import * as quic from "node:quic";
import * as buffer from "node:buffer";
import * as url from "node:url";
import * as http from "node:http";
import * as zlib from "node:zlib";
import * as workerThreads from "node:worker_threads";
import * as performanceHooks from "node:perf_hooks";
// @ts-ignore
import nodeFetch, { Headers as NodeFetchHeaders, Request as NodeFetchRequest, Response as NodeFetchResponse } from "node-fetch";
// @ts-ignore
import * as undici from "undici";

const lines: string[] = [];
const say = (label: string, value: unknown) => lines.push(label + ": " + JSON.stringify(value));
say("node:quic", Object.keys(quic).sort());
say("node:buffer", [buffer.Blob === Blob, buffer.File === File, typeof buffer.resolveObjectURL]);
say("node:url", [url.URL === URL, url.URLSearchParams === URLSearchParams, url.fileURLToPath(new URL("file:///C:/a/b")), url.urlToHttpOptions(new URL("http://user@example.com:81/a?b=c")).path]);
say("node:http", [typeof http.request, typeof http.createServer]);
say("node:zlib, node:worker_threads, node:perf_hooks", [typeof zlib.gzipSync, typeof workerThreads.Worker, typeof performanceHooks.performance.now]);
say("node-fetch", [
  typeof nodeFetch,
  new NodeFetchHeaders({ a: "1" }).get("a"),
  new NodeFetchRequest("http://example.com/a").url,
  new NodeFetchResponse("x", { status: 201 }).status,
  new NodeFetchResponse("x").clone() instanceof NodeFetchResponse,
  new NodeFetchResponse("x") instanceof Response,
]);
say("undici", [typeof undici.fetch, new undici.Headers({ a: "1" }).get("a"), new undici.Response("x", { status: 202 }).status, new undici.Request("http://example.com/b").url]);
say("crypto.subtle", typeof crypto.subtle.digest);
say("Bun.file", [Bun.file("/dev/null") instanceof Blob, Bun.file("/dev/null").size, Object.getPrototypeOf(Bun.file("/dev/null")) === Blob.prototype]);
say("File", [new File(["abc"], "a.txt").name, new File(["abc"], "a.txt").size, new File(["abc"], "a.txt") instanceof Blob]);
say("structuredClone of a Blob", structuredClone(new Blob(["abc"])).size);
say("FormData with a Blob", (() => {
  const form = new FormData();
  form.append("file", new Blob(["abc"]), "a.txt");
  return (form.get("file") as File).name;
})());
console.log(lines.join("\n"));
