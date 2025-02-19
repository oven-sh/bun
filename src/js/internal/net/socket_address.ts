const { SocketAddressNative, AF_INET } = require("../net");
import type { SocketAddressInitOptions } from "node:net";
const { validateObject, validatePort, validateString, validateUint32 } = require("internal/validators");

const kHandle = Symbol("kHandle");
const kInspect = Symbol.for("nodejs.util.inspect.custom");

var _lazyInspect = null;
function lazyInspect(...args) {
  return (_lazyInspect ??= require("node:util").inspect)(...args);
}

class SocketAddress {
  [kHandle]: SocketAddressNative;

  /**
   * @returns `true` if `value` is a {@link SocketAddress} instance.
   */
  static isSocketAddress(value: unknown): value is SocketAddress {
    // NOTE: some bun-specific APIs return `SocketAddressNative` instances.
    return $isObject(value) && (kHandle in value || value instanceof SocketAddressNative);
  }

  /**
   * Parse an address string with an optional port number.
   *
   * @param input the address string to parse, e.g. `1.2.3.4:1234` or `[::1]:0`
   * @returns a new {@link SocketAddress} instance or `undefined` if the input
   * is invalid.
   */
  static parse(input: string): SocketAddress | undefined {
    validateString(input, "input");

    try {
      const { hostname: address, port } = new URL(`http://${input}`);
      if (address.startsWith("[") && address.endsWith("]")) {
        return new SocketAddress({
          address: address.slice(1, -1),
          // @ts-ignore -- JSValue | 0 casts to number
          port: port | 0,
          family: "ipv6",
        });
      }
      return new SocketAddress({
        address,
        // @ts-ignore -- JSValue | 0 casts to number
        port: port | 0,
      });
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
      let { address, port, flowlabel, family = "ipv4" } = options;
      if (port !== undefined) validatePort(port, "options.port");
      if (address !== undefined) validateString(address, "options.address");
      if (flowlabel !== undefined) validateUint32(flowlabel, "options.flowlabel");
      // Bun's native SocketAddress allows `family` to be `AF_INET` or `AF_INET6`,
      // but since we're aiming for nodejs compat in node:net this is not allowed.
      if (typeof family?.toLowerCase === "function") {
        options.family = family = family.toLowerCase();
      }

      switch (family) {
        case "ipv4":
        case "ipv6":
          break;
        default:
          throw $ERR_INVALID_ARG_VALUE("options.family", options.family);
      }

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

  [kInspect](depth: number, options: NodeJS.InspectOptions) {
    if (depth < 0) return this;
    const opts = options.depth == null ? options : { ...options, depth: options.depth - 1 };
    return `SocketAddress ${lazyInspect(this.toJSON(), opts)}`;
  }

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
