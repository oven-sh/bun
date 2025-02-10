const { SocketAddressNative, AF_INET } = require("../net");
import type { SocketAddressInitOptions } from "node:net";
const { validateObject, validatePort, validateString } = require("internal/validators");

const kHandle = Symbol("kHandle");

class SocketAddress {
  [kHandle]: SocketAddressNative;

  static isSocketAddress(value: unknown): value is SocketAddress {
    return $isObject(value) && kHandle in value;
  }

  static parse(input: string): SocketAddress | undefined {
    validateString(input, "input");

    try {
      const { hostname: address, port } = new URL(`http://${input}`);
      if (address.startsWith("[") && address.endsWith("]")) {
        return new SocketAddress({
          address: address.slice(1, -1),
          port: port | 0,
          family: "ipv6",
        });
      }
      return new SocketAddress({ address, port: port | 0 });
    } catch {
      // node swallows this error, returning undefined for invalid addresses.
    }
  }

  constructor(options?: SocketAddressInitOptions | SocketAddressNative) {
    // allow null?
    if ($isUndefinedOrNull(options)) {
      this[kHandle] = new SocketAddressNative();
    } else {
      validateObject(options, "options");
      if (options.port !== undefined) validatePort(options.port, "options.port");
      this[kHandle] = new SocketAddressNative(options);
    }
  }

  get address() {
    return this[kHandle].address;
  }

  get port() {
    return this[kHandle].port;
  }

  get family() {
    return this[kHandle].addrfamily === AF_INET ? "ipv4" : "ipv6";
  }

  get flowlabel() {
    return this[kHandle].flowlabel;
  }

  // TODO: kInspect
  toJSON() {
    return {
      address: this.address,
      port: this.port,
      family: this.family,
      flowlabel: this.flowlabel,
    };
  }
}

export default { SocketAddress };
