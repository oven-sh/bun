import { EventEmitter, once } from "node:events";
const lines = [];
function watched(object, name) {
  return new Proxy(object, {
    get(target, key) {
      if (typeof key === "string" && key !== "constructor") lines.push(name + " " + key);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
const target = new EventTarget();
const ofTarget = once(watched(target, "target"), "ready");
target.dispatchEvent(new Event("ready"));
lines.push("target " + (await ofTarget)[0].type);
const emitter = new EventEmitter();
const ofEmitter = once(watched(emitter, "emitter"), "ready");
emitter.emit("ready", 1);
lines.push("emitter " + (await ofEmitter).join());
try {
  await once(watched({}, "neither"), "ready");
} catch (error) {
  lines.push("neither " + error.code);
}
console.log(lines.join("\n"));
process.exit(0);
