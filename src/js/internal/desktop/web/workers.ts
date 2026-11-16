const idl = require("internal/desktop/web/idl");
const messaging = require("internal/desktop/web/messaging");
const events = require("internal/desktop/web/dom").events;

const { scope } = idl;

function optionsOf(url: unknown, init: any, sink: string) {
  const text = scope.trusted("scriptURL", url, sink);
  const { credentials = "same-origin", extendedLifetime, name = "", type = "classic" } = idl.dictionary(init);
  const options = {
    credentials: idl.oneOf(credentials, ["omit", "same-origin", "include"]),
    hasExtendedLifetime: !!extendedLifetime,
    name: `${name}`,
    isModule: idl.oneOf(type, ["classic", "module"]) === "module",
  };
  if (scope.disposed) throw idl.error("InvalidAccessError", "The context is not active.");
  const parsed = idl.parseUrl(text, true);
  if (!parsed) throw idl.error("SyntaxError", `The URL '${text}' is invalid.`);
  const { origin, originOf, resolveBlob } = scope.env;
  if (parsed.protocol !== "data:" && originOf(parsed.href) !== origin) {
    throw idl.error("SecurityError", `Script at '${parsed}' cannot be accessed from origin '${origin}'.`);
  }
  return { ...options, url: parsed.href, blob: parsed.protocol === "blob:" ? resolveBlob(parsed.href) : undefined };
}

class Worker extends idl.EventTarget {
  #port: any;
  #thread: { terminate(): void };
  #isTerminated = false;

  constructor(url: string, init: any = undefined) {
    idl.need(arguments.length, 1);
    const options = optionsOf(url, init, "Worker constructor");
    super();
    const { port1, port2 } = new idl.native.MessageChannel();
    messaging.forward((this.#port = port1), this, () => this.#isTerminated);
    this.#thread = scope.env.createWorker(options, port2, failure => idl.runTask(() => this.#failed(failure)));
    scope.cleanups.add(() => port1.close());
  }

  #failed(failure: any) {
    if (this.#isTerminated) return;
    if (!failure) return idl.dispatchInTask(this, new idl.Event("error", { cancelable: true }));
    const init = { ...failure, error: null, cancelable: true };
    if (idl.dispatchInTask(this, new events.ErrorEvent("error", init))) scope.reportAt(init);
  }

  postMessage(message: unknown, options: any = undefined) {
    const port = this.#port;
    idl.need(arguments.length, 1);
    messaging.postTo(port, message, options);
  }

  terminate() {
    this.#isTerminated = true;
    this.#port.close();
    this.#thread.terminate();
  }
}
idl.defineHandlers(Worker.prototype, ["message", "messageerror", "error"]);
idl.expose(Worker);

class SharedWorker extends idl.EventTarget {
  #port: object;

  constructor(url: string, init: any = undefined) {
    idl.need(arguments.length, 1);
    const options = optionsOf(url, init == null || $isObject(init) ? init : { name: init }, "SharedWorker constructor");
    if (scope.env.origin === "null") throw idl.error("SecurityError", "Shared workers are denied to an opaque origin.");
    super();
    const { port1, port2 } = new idl.native.MessageChannel();
    this.#port = messaging.adopt(port1);
    scope.env.connectSharedWorker(options, port2, () => idl.runTask(() => idl.fire(this, "error")));
  }

  get port() {
    return this.#port;
  }
}
idl.defineHandlers(SharedWorker.prototype, ["error"]);
idl.expose(SharedWorker);

export default { SharedWorker, Worker };
