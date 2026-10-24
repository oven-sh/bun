import { EventEmitter, once } from "node:events";

class Download extends EventEmitter {
  constructor(size) {
    super();
    this.size = size;
    this.done = 0;
  }
  step(amount) {
    this.done = Math.min(this.size, this.done + amount);
    this.emit("progress", this.done, this.size);
    if (this.done === this.size) this.emit("finish", { bytes: this.done });
    return this;
  }
}

const download = new Download(10);
const log = [];
const onProgress = (done, size) => log.push(done + "/" + size);
download.on("progress", onProgress);
download.prependListener("progress", done => log.push("first " + done));
download.once("progress", () => log.push("only once"));
console.log(download.listenerCount("progress"), download.eventNames(), download.emit("nobody listens"));
const finished = once(download, "finish");
download.step(4).step(4);
download.off("progress", onProgress);
download.step(4);
console.log(log, await finished, download.listenerCount("progress"));

try {
  download.emit("error", new RangeError("no listener for errors"));
} catch (error) {
  console.log(error.name, error.message);
}
download.on("error", error => console.log("handled", error.message));
console.log(download.emit("error", new Error("second")));
download.setMaxListeners(1);
console.log(download.getMaxListeners(), download.rawListeners("error").length, download instanceof EventEmitter);
download.removeAllListeners();
console.log(download.eventNames());
