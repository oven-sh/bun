// on() and removeListener() of Readable called on a Proxy of a stream, under "data", "readable" and other names: every read, store and question that the Proxy sees, in order.
import { Readable } from "node:stream";

const tick = () => new Promise(resolve => setImmediate(resolve));
for (const name of ["data", "readable", "end", "close", "abcd", "abcdefgh", "", Symbol.for("made-up"), 4]) {
  const seen = [];
  const stream = new Readable({ read() {} });
  const proxy = new Proxy(stream, {
    get(target, key, receiver) {
      seen.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      seen.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    has(target, key) {
      seen.push("has " + String(key));
      return Reflect.has(target, key);
    },
  });
  const listener = () => {};
  const answer = Readable.prototype.on.call(proxy, name, listener);
  console.log("on", String(name), "|", answer === proxy, "|", seen.splice(0).join(", "));
  await tick();
  console.log("  a turn later |", seen.splice(0).join(", "));
  const gone = Readable.prototype.removeListener.call(proxy, name, listener);
  console.log("removeListener", String(name), "|", gone === proxy, "|", seen.splice(0).join(", "));
  await tick();
  console.log("  a turn later |", seen.splice(0).join(", "));
  stream.destroy();
}
