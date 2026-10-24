// Thrown values: a rejection handler typed for the program's own error class gets what native code rejects with: system errors, a SyntaxError, an AggregateError, and the primitives that the program gave to a controller.
import { readFile } from "node:fs/promises";

class Failure extends Error {
  code = 7;
}

let total = 0;

function onFailure(failure: Failure): [number, string] {
  if (typeof failure !== "object" || failure === null) return [1000000, typeof failure];
  return [typeof failure.code === "number" ? failure.code : typeof failure.code === "string" ? 100 : 10000, failure.name];
}

onFailure(new Failure("own"));
const failed = new ReadableStream({ start: controller => controller.error(5) });
const promises: Promise<unknown>[] = [
  Promise.reject(new Failure("rejected")),
  readFile("/no/such/file/anywhere"),
  Bun.file("/no/such/file/anywhere").text(),
  new Response("{").json(),
  Promise.any([]),
  WebAssembly.compile(new Uint8Array(2)),
  failed.getReader().read(),
  new Promise((resolve, reject) => reject()),
  new Response(null).body === null ? Promise.reject(null) : Promise.resolve(),
  (async () => { throw "text"; })(),
];
const names: string[] = [];
for (const outcome of await Promise.all(promises.map(promise => promise.catch(onFailure)))) {
  const [weight, name] = outcome as [number, string];
  total += weight;
  names.push(name);
}
console.log(total, names.join());
