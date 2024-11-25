import { MessageEvent, WebSocket } from "ws";

interface Listeners {
  onMessage: (data: MessageEvent["data"]) => void;
  /**
   * This will be called:
   * - When you call `.close()`
   * - When the WebSocket is reconnecting
   */
  onClose?: (isReconnecting: boolean) => void;
}

export function createReconnectingWS(url: string, listeners: Listeners) {
  let shouldReconnect = true;
  let isConnecting = false;

  const maybeReconnect = async () => {
    const skipReconnect = !shouldReconnect || isConnecting;

    listeners.onClose?.(!skipReconnect);

    if (skipReconnect) {
      return;
    }

    isConnecting = true;
    await new Promise(r => setTimeout(r, 1000));

    ws = getWs();
  };

  const onMessage = (event: MessageEvent) => {
    listeners.onMessage(event.data);
  };

  const open = () => {
    isConnecting = false;
  };

  const getWs = () => {
    const ws = new WebSocket(url);

    ws.on("open", open);
    ws.on("message", onMessage);
    ws.on("close", maybeReconnect);
    ws.on("error", maybeReconnect);

    return ws;
  };

  let ws = getWs();

  return {
    send: (data: string) => {
      ws.send(data);
    },
    close: () => {
      shouldReconnect = false;
      ws.close();
    },
  };
}
