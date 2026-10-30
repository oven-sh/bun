// Emitters that capture rejections: their own keys, the property `emit`, and what happens to a listener's rejected promise.
import { EventEmitter, EventEmitterAsyncResource, captureRejectionSymbol } from "node:events";
import { Readable, Writable, Duplex } from "node:stream";
import http from "node:http";
import net from "node:net";

const show = (label, object) => {
  const own = Object.getOwnPropertyDescriptor(object, "emit");
  console.log(
    label,
    Reflect.ownKeys(object).map(String).join(" "),
    "|",
    own ? `${own.value?.name}/${own.value?.length} ${own.writable} ${own.enumerable} ${own.configurable}` : "none",
    object.emit === EventEmitter.prototype.emit,
  );
};
process.on("unhandledRejection", error => console.log("unhandled", error.message));
const turn = () => new Promise(resolve => setImmediate(resolve));

class Below extends EventEmitter {
  count = 0;
}
show("plain", new EventEmitter());
show("captures", new EventEmitter({ captureRejections: true }));
show("does not", new EventEmitter({ captureRejections: false }));
show("below", new Below({ captureRejections: true }));
show("resource", new EventEmitterAsyncResource({ name: "r", captureRejections: true }));
show("called", (o => (EventEmitter.call(o, { captureRejections: true }), o))({ first: 1 }));
for (const key in new Below({ captureRejections: true })) console.log("for-in", key);
console.log(JSON.stringify(Object.keys(new EventEmitter({ captureRejections: true }))));

for (const make of [
  () => new EventEmitter({ captureRejections: true }),
  () => new Below({ captureRejections: true }),
  () => new EventEmitterAsyncResource({ name: "r", captureRejections: true }),
]) {
  const emitter = make();
  emitter.on("error", error => console.log("error", error.message));
  emitter.on("one", async value => {
    throw new Error("one " + value);
  });
  emitter.on("two", async () => {});
  emitter.on("two", async (a, b, c, d) => {
    throw new Error("two " + [a, b, c, d]);
  });
  console.log(emitter.emit("one", 1), emitter.emit("two", 1, 2, 3, 4), emitter.emit("none"));
  await turn();
  emitter[captureRejectionSymbol] = (error, type, ...args) => console.log("handler", error.message, type, args);
  emitter.emit("one", 2);
  await turn();
  console.log(EventEmitter.prototype.emit.call(emitter, "two", 5));
  await turn();
}

EventEmitter.captureRejections = true;
show("default", new EventEmitter());
show("default below", new Below());
show("default readable", new Readable({ read() {} }));
show("default writable", new Writable({ write() {} }));
show("default duplex", new Duplex({ read() {}, write() {} }));
show("default socket", new net.Socket());
show("default resource", new EventEmitterAsyncResource({ name: "r" }));
const { promise: rejectionIsHandedOn, resolve: handOn } = Promise.withResolvers();
const server = http.createServer((req, res) => {
  console.log("req", Object.hasOwn(req, "emit"), req.emit.name, "res", Object.hasOwn(res, "emit"), res.emit.name);
  console.log(Reflect.ownKeys(req).indexOf("emit") >= 0, Reflect.ownKeys(res).indexOf("emit") >= 0);
  res.on("finish", async () => {
    throw new Error("finish");
  });
  res.on("close", () => console.log("res close"));
  res.on("error", error => console.log("res error", error.message));
  const destroy = res.destroy;
  res.destroy = function (error) {
    console.log("res destroy", error?.message, this.destroyed, this.closed);
    const result = destroy.call(this, error);
    console.log(result === this, this.errored);
    handOn();
    return result;
  };
  res.end("ok");
});
show("default server", server);
await new Promise(resolve => server.listen(0, resolve));
const body = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
await rejectionIsHandedOn;
await turn();
console.log(body);
server.close();
show("new response", new http.ServerResponse(new http.IncomingMessage(new net.Socket())));
EventEmitter.captureRejections = false;
show("again", new EventEmitter());
