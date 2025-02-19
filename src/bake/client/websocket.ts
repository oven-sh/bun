const isLocal = location.host === "localhost" || location.host === "127.0.0.1";

let wait =
  typeof document !== "undefined"
    ? () =>
        new Promise<void>(done => {
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
          }
        })
    : () => new Promise<void>(done => setTimeout(done, 2_500));

let mainWebSocket: WebSocketWrapper | null = null;

interface WebSocketWrapper {
  /** When re-connected, this is re-assigned */
  wrapped: WebSocket | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
  [Symbol.dispose](): void;
}

export function getMainWebSocket(): WebSocketWrapper | null {
  return mainWebSocket;
}

export function initWebSocket(
  handlers: Record<number, (dv: DataView<ArrayBuffer>, ws: WebSocket) => void>,
  { url = "/_bun/hmr", displayMessage = "Live-reloading socket" }: { url?: string; displayMessage?: string } = {},
): WebSocketWrapper {
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
      if (mainWebSocket === this) {
        mainWebSocket = null;
      }
    },
    [Symbol.dispose]() {
      this.close();
    },
  };

  if (mainWebSocket === null) {
    mainWebSocket = wsProxy;
  }

  function onOpen() {
    if (firstConnection) {
      firstConnection = false;
      console.info(`[Bun] ${displayMessage} connected, waiting for changes...`);
    }
  }

  function onMessage(ev: MessageEvent<string | ArrayBuffer>) {
    const { data } = ev;
    if (typeof data === "object") {
      const view = new DataView(data);
      if (IS_BUN_DEVELOPMENT) {
        console.info("[WS] receive message '" + String.fromCharCode(view.getUint8(0)) + "',", new Uint8Array(data));
      }
      handlers[view.getUint8(0)]?.(view, ws);
    }
  }

  function onError(ev: Event) {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      // Auto-reconnection already logged a warning.
      ev.preventDefault();
    }
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

  let ws = (wsProxy.wrapped = new WebSocket(url));
  ws.binaryType = "arraybuffer";
  ws.onopen = onOpen;
  ws.onmessage = onMessage;
  ws.onclose = onClose;
  ws.onerror = onError;

  return wsProxy;
}
