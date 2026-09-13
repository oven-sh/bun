const { isIPv6 } = require("internal/net/isIP");

let dns: typeof import("node:dns");
const kListenCallbackGeneration = Symbol("server.listenCallbackGeneration");
const kEmittingListenCallbackGeneration = Symbol("server.emittingListenCallbackGeneration");

function isIPv6LinkLocal(address: string): boolean {
  if (!isIPv6(address)) return false;

  const first = address.$charCodeAt(0) | 0x20;
  const second = address.$charCodeAt(1) | 0x20;
  const third = address.$charCodeAt(2) | 0x20;
  return first === 0x66 && second === 0x65 && (third === 0x38 || third === 0x39 || third === 0x61 || third === 0x62);
}

function selectListenAddress(addresses: Array<{ address: string; family: number }>) {
  // Match Node's lookupAndListen: prefer a routable result when getaddrinfo also returns IPv6 link-local addresses.
  for (let i = 0; i < addresses.length; i++) {
    if (!isIPv6LinkLocal(addresses[i].address)) return addresses[i];
  }
  return addresses[0];
}

function lookupListenAddress(
  hostname: string,
  callback: (err: Error | null, address?: string, family?: number) => void,
) {
  if (dns === undefined) dns = require("node:dns");
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }

    const selected = selectListenAddress(addresses);
    callback(null, selected.address, selected.family === 6 ? 6 : 4);
  });
}

function registerListenCallback(server, callback) {
  // Bind errors keep the callback for a retry, while close() starts a new callback generation.
  // `.listener` preserves once-listener removal and introspection by the original callback.
  const generation = server[kListenCallbackGeneration] || 0;
  let fired = false;
  function listener(...args) {
    if (fired) return;
    const emittingGeneration = server[kEmittingListenCallbackGeneration];
    const eventGeneration =
      emittingGeneration === undefined ? server[kListenCallbackGeneration] || 0 : emittingGeneration;
    if (eventGeneration !== generation) {
      if (eventGeneration > generation) {
        fired = true;
        server.removeListener("listening", listener);
      }
      return;
    }
    fired = true;
    server.removeListener("listening", listener);
    return callback.$apply(server, args);
  }
  listener.listener = callback;
  server.on("listening", listener);
}

function invalidateListenCallbacks(server) {
  server[kListenCallbackGeneration] = (server[kListenCallbackGeneration] || 0) + 1;
}

function emitListeningEvent(server, ...args) {
  // close() may run inside the first listen callback. Keep the dispatch generation stable so
  // sibling callbacks from that same successful listen still run from EventEmitter's listener copy.
  server[kEmittingListenCallbackGeneration] = server[kListenCallbackGeneration] || 0;
  try {
    return server.emit("listening", ...args);
  } finally {
    server[kEmittingListenCallbackGeneration] = undefined;
  }
}

export default {
  emitListeningEvent,
  invalidateListenCallbacks,
  lookupListenAddress,
  registerListenCallback,
};
