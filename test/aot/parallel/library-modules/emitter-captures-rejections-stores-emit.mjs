// What stands under `emit` above an emitter that captures rejections: an accessor, a property that is read-only, a proxy.
import { EventEmitter } from "node:events";
class WithSetter extends EventEmitter {
  set emit(value) {
    console.log("setter", typeof value, value.name);
  }
  get emit() {
    return super.emit;
  }
}
const attempt = (label, run) => {
  try {
    const made = run();
    console.log(label, Object.hasOwn(made, "emit"));
  } catch (error) {
    console.log(label, error.constructor.name, error.message);
  }
};
attempt("setter", () => new WithSetter({ captureRejections: true }));
class ReadOnly extends EventEmitter {}
Object.defineProperty(ReadOnly.prototype, "emit", { value() {}, writable: false });
attempt("read-only", () => new ReadOnly({ captureRejections: true }));
attempt("own", () => {
  const object = {};
  Object.defineProperty(object, "emit", { value: 1, writable: true, enumerable: false, configurable: false });
  EventEmitter.call(object, { captureRejections: true });
  console.log(JSON.stringify(Object.getOwnPropertyDescriptor(object, "emit")));
  return object;
});
attempt("proxy", () => {
  const traps = [];
  const proxy = new Proxy(Object.create(EventEmitter.prototype), {
    set(target, key, value, receiver) {
      traps.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    defineProperty(target, key, descriptor) {
      traps.push("define " + String(key));
      return Reflect.defineProperty(target, key, descriptor);
    },
  });
  EventEmitter.call(proxy, { captureRejections: true });
  console.log(traps.join(", "));
  return proxy;
});
