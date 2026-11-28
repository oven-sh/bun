// Injected renderer-side preload bridge for `bun --desktop` webviews.
type Listener = (event: { senderId: number }, ...args: unknown[]) => void;

const listeners = new Map<string, Set<Listener>>();

function postToHost(payload: unknown): Promise<unknown> {
  const w = globalThis as any;
  if (w.webkit?.messageHandlers?.bunIpc?.postMessage) {
    return w.webkit.messageHandlers.bunIpc.postMessage(payload);
  }
  if (w.chrome?.webview?.postMessage) {
    w.chrome.webview.postMessage(payload);
    return Promise.resolve(undefined);
  }
  return Promise.reject(new Error("Bun desktop IPC bridge is not available in this context"));
}

export const ipcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return postToHost({ type: "invoke", channel, args });
  },
  send(channel: string, ...args: unknown[]): void {
    void postToHost({ type: "send", channel, args });
  },
  on(channel: string, listener: Listener) {
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
    }
    set.add(listener);
    return ipcRenderer;
  },
  once(channel: string, listener: Listener) {
    const wrapped: Listener = (event, ...args) => {
      ipcRenderer.removeListener(channel, wrapped);
      listener(event, ...args);
    };
    return ipcRenderer.on(channel, wrapped);
  },
  removeListener(channel: string, listener: Listener) {
    listeners.get(channel)?.delete(listener);
    return ipcRenderer;
  },
  removeAllListeners(channel?: string) {
    if (channel === undefined) {
      listeners.clear();
    } else {
      listeners.delete(channel);
    }
    return ipcRenderer;
  },
};

export const contextBridge = {
  exposeInMainWorld(apiKey: string, api: unknown) {
    (globalThis as any)[apiKey] = api;
  },
};

(globalThis as any).__bunIpcDispatch = (channel: string, args: unknown[]) => {
  const set = listeners.get(channel);
  if (!set) return;
  for (const fn of set) {
    fn({ senderId: 0 }, ...args);
  }
};
