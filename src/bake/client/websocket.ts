const isLocal = location.host === "localhost" || location.host === "127.0.0.1";

let wait = typeof document !== 'undefined'
  ? () => new Promise<void>(done => {
    let timer: Timer | null = null;

    const onBlur = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onTimeout = () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", onTimeout);
      window.removeEventListener("blur", onBlur);
      done();
    };

    window.addEventListener("focus", onTimeout);

    if (document.hasFocus()) {
      timer = setTimeout(
        () => {
          timer = null;
          onTimeout();
        },
        isLocal ? 2_500 : 2_500,
      );

      window.addEventListener("blur", onBlur);
    }})
  : () => new Promise<void>(done => setTimeout(done, 2_500));

interface WebSocketWrapper {
  /** When re-connected, this is re-assigned */
  wrapped: WebSocket | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
  [Symbol.dispose](): void;
}

export function initWebSocket(handlers: Record<number, (dv: DataView, ws: WebSocket) => void>, url: string = "/_bun/hmr") :WebSocketWrapper {
  let firstConnection = true;
  let closed = false;

  const wsProxy: WebSocketWrapper = {
    wrapped: null,
    send(data) {
      const wrapped = this.wrapped;
      if (wrapped && wrapped.readyState === 1) {
        wrapped.send(data);
      }
    },
    close() {
      closed = true;
      this.wrapped?.close();
    },
    [Symbol.dispose]() {
      this.close();
    },
  };

  function onOpen() {
    if (firstConnection) {
      firstConnection = false;
      console.info("[Bun] Hot-module-reloading socket connected, waiting for changes...");
    }
  }

  function onMessage(ev: MessageEvent<string | ArrayBuffer>) {
    const { data } = ev;
    if (typeof data === "object") {
      const view = new DataView(data);
      if (IS_BUN_DEVELOPMENT) {
        console.info("[WS] " + String.fromCharCode(view.getUint8(0)));
      }
      handlers[view.getUint8(0)]?.(view, ws);
    }
  }

  function onError(ev: Event) {
    console.error(ev);
  }

  async function onClose() {
    console.warn("[Bun] Hot-module-reloading socket disconnected, reconnecting...");

    while (true) {
      if (closed) return;
      await wait();

      // Note: Cannot use Promise.withResolvers due to lacking support on iOS
      let done;
      const promise = new Promise<boolean>(cb => (done = cb));

      ws = wsProxy.wrapped = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        console.info("[Bun] Reconnected");
        done(true);
        onOpen();
        ws.onerror = onError;
      };
      ws.onmessage = onMessage;
      ws.onerror = ev => {
        onError(ev);
        done(false);
      };

      if (await promise) {
        break;
      }
    }
  }

  let ws = wsProxy.wrapped = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = onOpen;
  ws.onmessage = onMessage;
  ws.onclose = onClose;
  ws.onerror = onError;

  return wsProxy;
}
