// Each Worker has a realm of its own, and a realm makes a class of the host at its first use. Forty Workers make their first Request, Response, Headers, Blob and URL
// while collections come and go.
import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  let sum = 0;
  const turns = 40;
  await new Promise(resolve => {
    let ended = 0;
    for (let i = 0; i < turns; i++) {
      const worker = new Worker(import.meta.filename ?? import.meta.path);
      worker.on("message", n => { sum += n; });
      worker.on("exit", () => { if (++ended === turns) resolve(); });
    }
  });
  console.log("workers:", turns, "sum:", sum);
} else {
  const garbage = [];
  for (let i = 0; i < 2000; i++) garbage.push({ i });
  const request = new Request("http://localhost/a", { method: "POST", body: "x" });
  const response = new Response("y", { headers: new Headers({ a: "b" }) });
  const blob = new Blob(["z"]);
  const url = new URL(request.url);
  parentPort.postMessage(request.method.length + response.status + blob.size + url.pathname.length + garbage.length);
}
