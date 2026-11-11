// Without the DOM's library the web globals get their members from a base that the types of Bun gate: a file, the events, a signal, an exception
// of the DOM, the strategies, the streams, a channel and what makes random values. The members are read as tsc reads them. An error would be
// "Property 'name' does not exist on type 'File'."
export {};
const file = new File(["hello"], "a.txt", { type: "text/plain" });
console.log(file.name, file.size, file.type, await file.text(), (await file.arrayBuffer()).byteLength, await file.slice(1, 3).text());

const failed = new ErrorEvent("error", { message: "boom", lineno: 3 });
const closed = new CloseEvent("close", { code: 1001, reason: "away", wasClean: true });
class Tagged extends CustomEvent<{ id: number; tag: string }> {
  get label(): string {
    return this.detail.tag + this.detail.id;
  }
}
console.log(failed.message, failed.lineno, closed.code, closed.reason, closed.wasClean, new Tagged("tagged", { detail: { id: 7, tag: "T" } }).label);

const controller = new AbortController();
const signal: AbortSignal = controller.signal;
signal.onabort = event => console.log(event.type + "ed", signal.aborted, signal.reason);
controller.abort("stop");
try {
  signal.throwIfAborted();
} catch (reason) {
  console.log("threw", reason);
}

class Refused extends DOMException {
  describe(): string {
    return `${this.name}:${this.message}:${this.code}`;
  }
}
const refused = new Refused("no", "NotAllowedError");
console.log(refused.describe(), refused instanceof Error);

const counted = new CountQueuingStrategy({ highWaterMark: 2 });
const sized = new ByteLengthQueuingStrategy({ highWaterMark: 16 });
console.log(counted.highWaterMark, counted.size(), sized.highWaterMark, sized.size(new Uint8Array(3)));

const upper = new TransformStream<string, string>({
  transform(chunk, out) {
    out.enqueue(chunk.toUpperCase());
  },
});
const writer = upper.writable.getWriter();
const reader = upper.readable.getReader();
void writer
  .write("a")
  .then(() => writer.write("b"))
  .then(() => writer.close());
for (let read = await reader.read(); !read.done; read = await reader.read()) console.log(read.value);
reader.releaseLock();

const channel = new MessageChannel();
const got = new Promise<string>(resolve => channel.port2.addEventListener("message", event => resolve(`got ${event.data}`)));
channel.port2.start();
channel.port1.postMessage("ping");
console.log(await got);
channel.port1.close();

const id: string = crypto.randomUUID();
console.log(id.length, typeof crypto.subtle.digest, crypto.getRandomValues(new Uint8Array(2)).length);
