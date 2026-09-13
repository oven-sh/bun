const { isIPv6 } = require("internal/net/isIP");

let dns: typeof import("node:dns");

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
  server.once("listening", callback);
}

function emitListeningEvent(server, ...args) {
  return server.emit("listening", ...args);
}

export default {
  emitListeningEvent,
  lookupListenAddress,
  registerListenCallback,
};
