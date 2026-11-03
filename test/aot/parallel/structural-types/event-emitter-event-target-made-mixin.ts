// An event emitter and an event target made by a mixin.
import { EventEmitter } from "node:events";

function Tagged<T extends object>(Base: new () => T): new () => T & { tag: string } {
  const Parent: new () => object = Base;
  const Made: new () => object = class extends Parent {
    tag = "tagged";
  };
  const bag: object = { Made };
  return Reflect.get(bag, "Made");
}

const seen: string[] = [];
const emitter = new (Tagged(EventEmitter))();
emitter.on("ping", (n: number) => seen.push("emitter got " + n));
console.log("emitted: " + emitter.emit("ping", 1) + " " + emitter.emit("nobody") + " tag " + emitter.tag + " has tag key: " + Object.keys(emitter).includes("tag") + " listeners " + emitter.listenerCount("ping"));

const target = new (Tagged(EventTarget))();
target.addEventListener("ping", event => seen.push("target got " + event.type));
console.log("dispatched: " + target.dispatchEvent(new Event("ping")) + " tag " + target.tag + " keys " + Object.keys(target).join(" "));
console.log(seen.join(", "));
console.log("instance: " + (emitter instanceof EventEmitter) + " " + (target instanceof EventTarget));
