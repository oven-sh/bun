const isLocal = location.host === "localhost" || location.host === "127.0.0.1";

function wait() {
  return new Promise<void>(done => {
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
  });
}

export function initWebSocket(handlers: Record<number, (dv: DataView) => void>) {
  let firstConnection = true;

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
      handlers[view.getUint8(0)]?.(view);
    }
  }

  function onError(ev: Event) {
    console.error(ev);
  }

  async function onClose() {
    console.warn("[Bun] Hot-module-reloading socket disconnected, reconnecting...");

    while (true) {
      await wait();

      // Note: Cannot use Promise.withResolvers due to lacking support on iOS
      let done;
      const promise = new Promise<boolean>(cb => (done = cb));

      ws = new WebSocket("/_bun/hmr");
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

  let ws = new WebSocket("/_bun/hmr");
  ws.binaryType = "arraybuffer";
  ws.onopen = onOpen;
  ws.onmessage = onMessage;
  ws.onclose = onClose;
  ws.onerror = onError;

  return {
    close: () => ws.close(),
    send: (data: ArrayBuffer) => ws.send(data),
  };
}
