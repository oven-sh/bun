// What a preload script sees. It runs in the realm that loads this module.
const EventEmitter = require("node:events");
const bridge = require("internal/desktop/electron/bridge");
const clone = structuredClone;
const NodeBuffer = Buffer;
const immediates = { setImmediate, clearImmediate };

function cloneable<T>(send: () => T): T {
  try {
    return send();
  } catch (error: any) {
    throw error?.name === "DataCloneError" ? new Error("An object could not be cloned.") : bridge.ownError(error);
  }
}

function validateChannel(channel: unknown) {
  if (typeof channel !== "string")
    throw new TypeError("Error processing argument at index 1, conversion failure from " + String(channel));
}

/** `worlds` has the realm of the page as 0. */
function create(env: any, worldOf: (id: number) => any) {
  const { ipc, frame } = env;
  const ipcRenderer = Object.assign(new EventEmitter(), {
    send(channel: string, ...args: unknown[]) {
      validateChannel(channel);
      cloneable(() => ipc.send(channel, args));
    },
    sendSync(channel: string, ...args: unknown[]) {
      validateChannel(channel);
      return clone(cloneable(() => ipc.sendSync(channel, args)));
    },
    sendToHost() {},
    invoke(channel: string, ...args: unknown[]) {
      return new Promise((resolve, reject) => {
        validateChannel(channel);
        cloneable(() =>
          ipc.invoke(channel, args, (error: string | undefined, result: unknown) => {
            if (error !== undefined) return reject(new Error(`Error invoking remote method '${channel}': ${error}`));
            resolve(result);
          }),
        );
      });
    },
    postMessage(channel: string, message: unknown, transfer: MessagePort[] = []) {
      validateChannel(channel);
      cloneable(() => ipc.postMessage(channel, message, [...transfer]));
    },
  });

  const toWorld = (id: number) => {
    if (!env.contextIsolated) throw new Error("contextBridge API can only be used when contextIsolation is enabled");
    return worldOf(id);
  };
  const link = (other: unknown) => ({ ...env.link, other });
  const contextBridge = {
    exposeInMainWorld: (name: string, api: unknown) => contextBridge.exposeInIsolatedWorld(0, name, api),
    exposeInIsolatedWorld(id: number, name: string, api: unknown) {
      const world = toWorld(id);
      cloneable(() => world.bridge.expose(name, api, link(bridge)));
    },
    executeInMainWorld({ func, args = [] }: { func: Function; args?: unknown[] }) {
      const world = toWorld(0);
      let result;
      try {
        result = world.evaluate(`(${func})`, "").$apply(undefined, world.bridge.copy(args, link(bridge)));
      } catch (error) {
        throw bridge.copy(error, link(world.bridge));
      }
      return bridge.copy(result, link(world.bridge));
    },
  };

  function execute(world: number, code: string, callback?: Function) {
    const promise = bridge.adopt(frame.executeJavaScript(world, code), clone);
    if (callback)
      promise.then(
        result => callback(result),
        error => callback(undefined, error),
      );
    return promise;
  }
  const webFrame: any = Object.assign(new EventEmitter(), {
    routingId: frame.routingId,
    frameToken: frame.frameToken,
    parent: null,
    opener: null,
    firstChild: null,
    nextSibling: null,
    getZoomFactor: () => frame.getZoomFactor(),
    setZoomFactor: (factor: number) => frame.setZoomFactor(+factor),
    getZoomLevel: () => frame.getZoomLevel(),
    setZoomLevel: (level: number) => frame.setZoomLevel(+level),
    setVisualZoomLevelLimits() {},
    setSpellCheckProvider() {},
    setIsolatedWorldInfo() {},
    insertCSS: (css: string) => frame.insertCSS(String(css)),
    removeInsertedCSS: (key: string) => frame.removeInsertedCSS(key),
    insertText: (text: string) => frame.insertText(String(text)),
    executeJavaScript: (code: string, gesture?: unknown, callback?: Function) =>
      execute(0, code, $isCallable(gesture) ? gesture : callback),
    executeJavaScriptInIsolatedWorld: (id: number, scripts: { code: string }[], _?: boolean, callback?: Function) =>
      execute(id, scripts.map(script => script.code).join(";\n"), callback),
    getResourceUsage: () => ({}),
    clearCache() {},
    getFrameForSelector: () => null,
    findFrameByName: () => null,
    findFrameByRoutingId: (id: number) => (id === frame.routingId ? webFrame : null),
    findFrameByToken: (token: string) => (token === frame.frameToken ? webFrame : null),
    isWordMisspelled: () => false,
    getWordSuggestions: () => [],
  });
  webFrame.top = webFrame;

  const electron = {
    contextBridge,
    ipcRenderer,
    webFrame,
    webUtils: { getPathForFile: (file: File) => env.pathForFile(file) },
    crashReporter: {
      addExtraParameter() {},
      removeExtraParameter() {},
      getParameters: () => ({}),
    },
    get nativeImage() {
      return env.nativeImage;
    },
    ...env.unsandboxed?.electron,
  };

  const started = performance.now();
  const sandboxedProcess: any = Object.assign(new EventEmitter(), clone(env.process), {
    nextTick: (callback: Function, ...args: unknown[]) => queueMicrotask(() => callback(...args)),
    emitWarning: (warning: unknown) => globalThis.console.warn(String(warning)),
    uptime: () => (performance.now() - started) / 1000,
    cwd: () => "/",
  });
  for (const name of Object.keys(env.processMethods)) {
    sandboxedProcess[name] = () => {
      const result = env.processMethods[name]();
      return $isPromise(result) ? bridge.adopt(result, clone) : clone(result);
    };
  }
  const process = env.unsandboxed?.process ?? sandboxedProcess;

  const timers = {
    ...immediates,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const available = { __proto__: null, events: EventEmitter, timers };
  Object.defineProperty(available, "url", { get: () => require("node:url"), enumerable: true });
  const requireFrom = (file: string) => (id: string) => {
    if (/^electron(?:\/(?:renderer|common))?$/.test(id)) return electron;
    const { unsandboxed } = env;
    if (unsandboxed) return unsandboxed.createRequire(file)(id);
    const found = available[id.replace(/^node:/, "")];
    if (!found) throw new Error(`module not found: ${id}`);
    return found;
  };

  if (env.contextIsolated || env.nodeIntegration) {
    bridge.define(globalThis, { process, Buffer: NodeBuffer, global: globalThis, ...immediates });
  }
  if (env.nodeIntegration)
    bridge.define(globalThis, { require: requireFrom(env.documentPath), module: { exports: {} } });

  return {
    run(script: Function, file: string) {
      const module = { exports: {} };
      (script as any).$call(
        module.exports,
        requireFrom(file),
        process,
        NodeBuffer,
        globalThis,
        immediates.setImmediate,
        immediates.clearImmediate,
        module.exports,
        module,
        ...(env.unsandboxed ? [file, env.unsandboxed.dirname(file)] : []),
      );
    },
    loaded: () => sandboxedProcess.emit("loaded"),
    receive(channel: string, args: unknown[], ports: MessagePort[]) {
      ipcRenderer.emit(channel, { sender: ipcRenderer, ports: [...ports] }, ...args);
    },
  };
}

export default { create };
