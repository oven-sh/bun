// RFC 9110 7.2: Host = uri-host [ ":" port ]. An IPv6 literal is in brackets. No other uri-host has ":", "[" or "]".
const hostAndPort = /^(\[[^\]]*\]|[^:[\]]*)(?::(\d*))?$/;

// The header is matched as sent. `new URL()` turns `evil.example@localhost`, `loc%61lhost` and `127.1` into listed names.
// Node's IsAllowedHost is the reference: https://github.com/nodejs/node/blob/v26.3.0/src/inspector_socket.cc#L642
// Unlike Node, this list has the bound hostname, `localhost6`, 0.0.0.0/8 and `[::]`, and the port is checked.
function isHostAllowed(host: string | null, expectedHostname: string): boolean {
  if (!host) {
    return true;
  }
  const match = hostAndPort.exec(host);
  if (!match || (match[2] && Number(match[2]) > 65535)) {
    return false;
  }
  const hostname = match[1].toLowerCase();
  if (hostname === expectedHostname || hostname === "localhost" || hostname === "localhost6") {
    return true;
  }
  const { isIPv4, isIPv6 } = require("internal/net/isIP");
  if (hostname.startsWith("[")) {
    // net.isIPv6() takes a "%zone". Node's inspector refuses one.
    return !hostname.includes("%") && isIPv6(hostname.slice(1, -1));
  }
  return isIPv4(hostname);
}

export default { isHostAllowed };
