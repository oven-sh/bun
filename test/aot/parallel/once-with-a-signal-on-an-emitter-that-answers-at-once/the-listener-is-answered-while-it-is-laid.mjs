import { EventEmitter, once, getEventListeners } from "node:events";
const lines = [];
class AnswersAtOnce extends EventEmitter {
  once(type, listener) {
    super.once(type, listener);
    if (type === "ready") this.emit("ready", 7);
    return this;
  }
}
class FailsAtOnce extends EventEmitter {
  once(type, listener) {
    super.once(type, listener);
    if (type === "error") this.emit("error", new RangeError("made up"));
    return this;
  }
}
for (const Kind of [AnswersAtOnce, FailsAtOnce]) {
  for (const withSignal of [false, true]) {
    const controller = new AbortController();
    const emitter = new Kind();
    try {
      const value = await once(emitter, "ready", withSignal ? { signal: controller.signal } : {});
      lines.push(Kind.name + " " + withSignal + " value " + JSON.stringify(value));
    } catch (error) {
      lines.push(Kind.name + " " + withSignal + " threw " + error.name + " " + error.message);
    }
    lines.push("ready left " + emitter.listenerCount("ready"));
    lines.push("error left " + emitter.listenerCount("error"));
    lines.push("abort left " + getEventListeners(controller.signal, "abort").length);
    controller.abort();
    lines.push("abort left behind the abort " + getEventListeners(controller.signal, "abort").length);
  }
}
console.log(lines.join("\n"));
