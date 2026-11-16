// The global object of a worker.
const idl = require("internal/desktop/web/idl");
const core = require("internal/desktop/web/dom").core;
const { events } = require("internal/desktop/web/dom");
const messaging = require("internal/desktop/web/messaging");

const { expose, internal, scope } = idl;
const { env, global } = scope;

class WorkerLocation {
  #url = new URL(env.url);

  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  static {
    for (const part of core.splitTokens("href origin protocol host hostname port pathname search hash")) {
      const holder = {
        get [part]() {
          return (this as any).#url[part];
        },
      };
      core.accessor(this.prototype, part, Object.getOwnPropertyDescriptor(holder, part)!.get);
    }
  }

  toString() {
    return this.#url.href;
  }
}

class WorkerNavigator {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }
}
const languages = Object.freeze([...env.languages]);
for (const [name, value] of Object.entries({
  appCodeName: "Mozilla",
  appName: "Netscape",
  appVersion: env.userAgent.replace(/^Mozilla./, ""),
  deviceMemory: 8,
  hardwareConcurrency: navigator.hardwareConcurrency,
  language: languages[0],
  languages,
  platform: navigator.platform,
  product: "Gecko",
  userAgent: env.userAgent,
})) {
  idl.attribute(WorkerNavigator, name, () => value);
}

idl.attribute(WorkerNavigator, "onLine", () => env.isOnline());

function importScript(url: string) {
  let loaded;
  try {
    loaded = env.loadScriptSync(url, "classic", { blob: url.startsWith("blob:") ? env.resolveBlob(url) : undefined });
  } catch {
    throw idl.error("NetworkError", `The script at '${url}' failed to load.`);
  }
  try {
    scope.evaluate(loaded.source, loaded.url);
  } catch (thrown) {
    throw loaded.isMuted ? idl.error("NetworkError", `The script at '${url}' failed to run.`) : thrown;
  }
}

class WorkerGlobalScope extends idl.EventTarget {
  constructor() {
    idl.illegal(undefined);
    super();
  }

  importScripts(...urls: unknown[]) {
    const given = urls.map(url => scope.trusted("scriptURL", url, "WorkerGlobalScope importScripts"));
    if (env.isModule) throw new TypeError("Module scripts don't support importScripts().");
    const parsed = given.map(url => idl.parseUrl(url));
    if (parsed.includes(null)) throw idl.error("SyntaxError", "The URL is invalid.");
    for (const url of parsed) importScript(url!.href);
  }
}
class DedicatedWorkerGlobalScope extends WorkerGlobalScope {}
class SharedWorkerGlobalScope extends WorkerGlobalScope {}

let port: any;

function connect(given: object) {
  const native = idl.native.structuredClone(given, { transfer: [given] } as any);
  if (!env.isShared) return void (port = native);
  const own = messaging.adopt(native);
  idl.runTask(() => idl.dispatchInTask(global, messaging.messageEvent("connect", "", "", own, [own])));
}

/** To delete what is in the static table of the global object is to make all that the table has. See DesktopRealm.cpp. */
function inherit(name: string) {
  Object.defineProperty(global, name, { value: undefined, writable: true, enumerable: false, configurable: true });
  if (Object.hasOwn(global, name)) return void delete global[name];
  for (let from = Object.getPrototypeOf(global); from !== null; from = Object.getPrototypeOf(from)) {
    const inherited = Object.getOwnPropertyDescriptor(from, name);
    if (inherited) return void Object.defineProperty(global, name, inherited);
  }
}

function install() {
  const Scope = env.isShared ? SharedWorkerGlobalScope : DedicatedWorkerGlobalScope;
  const [location, navigator] = [new WorkerLocation(internal), new WorkerNavigator(internal)];
  const { prototype } = WorkerGlobalScope;
  core.accessor(prototype, "self", () => global);
  core.accessor(prototype, "location", () => location);
  core.accessor(prototype, "navigator", () => navigator);
  idl.defineHandlers(
    prototype,
    core.splitTokens("error languagechange offline online rejectionhandled securitypolicyviolation unhandledrejection"),
  );
  Object.setPrototypeOf(global, Scope.prototype);
  for (const name of core.splitTokens("addEventListener dispatchEvent navigator onerror removeEventListener self"))
    inherit(name);
  if (env.isShared) for (const name of ["onmessage", "postMessage"]) inherit(name);
  idl.defineHandlers(global, env.isShared ? ["connect"] : ["message", "messageerror"]);
  idl.replaceable(global, "name", () => env.name);
  global.close = function close() {
    scope.dispose();
    env.close();
  };
  if (!env.isShared) {
    const frames = new Map<number, object>();
    let nextFrame = 1;
    global.requestAnimationFrame = function requestAnimationFrame(callback: Function) {
      idl.callable(callback);
      const id = nextFrame++;
      const run = () => frames.$delete(id) && callback(core.coarse(performance.now() - scope.timeOrigin));
      frames.$set(
        id,
        env.tasks.postDelayed(16, false, idl.runTask, () => events.callBack(scope.page, run)),
      );
      return id;
    };
    global.cancelAnimationFrame = function cancelAnimationFrame(id: number) {
      idl.need(arguments.length, 1);
      frames.$delete(id >>> 0);
    };
    global.postMessage = function postMessage(message: unknown, options: any = undefined) {
      idl.need(arguments.length, 1);
      messaging.postTo(port, message, options);
    };
  }
  const interfaces = [WorkerGlobalScope, Scope, WorkerLocation, WorkerNavigator].map(it => expose(it));
  return { interfaces, Navigator: WorkerNavigator };
}

export default { connect, inherit, install, started: () => port && messaging.forward(port, global) };
