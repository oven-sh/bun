import { MessageChannel as NodeChannel, receiveMessageOnPort } from "node:worker_threads";

const original = { date: new Date(5), pattern: /a/gi, map: new Map([["k", new Set([1])]]), bytes: new Uint8Array([1, 2]), big: 5n, list: [1, , 3], nested: { undefinedValue: undefined, nan: NaN }, error: new RangeError("kept") };
original.self = original;
const copy = structuredClone(original);
console.log(copy !== original, copy.self === copy, copy.date.getTime(), copy.pattern.flags, copy.map.get("k").has(1), copy.bytes, copy.big, 1 in copy.list, "undefinedValue" in copy.nested, copy.error.name, copy.error instanceof RangeError);
class Point {
  constructor() {
    this.x = 1;
  }
  get double() {
    return this.x * 2;
  }
}
console.log(structuredClone(new Point()) instanceof Point, structuredClone(new Point()), structuredClone(Object.create({ inherited: 1 })), structuredClone("text"), structuredClone(null));
for (const bad of [() => {}, Symbol("s"), { method() {} }, new WeakMap()]) {
  try {
    structuredClone(bad);
  } catch (error) {
    console.log(error.name, error.code, error instanceof DOMException);
  }
}
const buffer = new ArrayBuffer(8);
const moved = structuredClone(buffer, { transfer: [buffer] });
console.log(buffer.byteLength, moved.byteLength, buffer.detached);

const { port1, port2 } = new MessageChannel();
const got = [];
const all = new Promise(resolve => {
  port2.onmessage = event => {
    got.push(event.data);
    if (got.length === 3) resolve();
  };
});
port1.postMessage("text");
port1.postMessage({ list: [1, 2], when: new Date(0) });
port1.postMessage(new Map([[1, 2]]));
await all;
console.log(got);
port1.close();
port2.close();

const channel = new NodeChannel();
channel.port1.postMessage({ hello: "world" });
console.log(receiveMessageOnPort(channel.port2), receiveMessageOnPort(channel.port2));
channel.port1.close();

const target = new EventTarget();
const heard = [];
target.addEventListener("ping", event => heard.push(event.type + " " + event.detail + " " + (event.target === target)));
target.addEventListener("ping", { handleEvent: event => heard.push("object listener " + event.cancelable) }, { once: true });
console.log(target.dispatchEvent(new CustomEvent("ping", { detail: 7 })), target.dispatchEvent(new CustomEvent("ping", { detail: 8, cancelable: true })), heard);
