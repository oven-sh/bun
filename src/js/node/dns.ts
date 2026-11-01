// Hardcoded module "node:dns"
const dns = Bun.dns;
const utilPromisifyCustomSymbol = Symbol.for("nodejs.util.promisify.custom");
const { isIP } = require("internal/net/isIP");
const { guardCallback } = require("internal/shared");
const {
  validateFunction,
  validateArray,
  validateString,
  validateBoolean,
  validateNumber,
  validateInt32,
  validatePort,
} = require("internal/validators");

const errorCodes = {
  NODATA: "ENODATA",
  FORMERR: "EFORMERR",
  SERVFAIL: "ESERVFAIL",
  NOTFOUND: "ENOTFOUND",
  NOTIMP: "ENOTIMP",
  REFUSED: "EREFUSED",
  BADQUERY: "EBADQUERY",
  BADNAME: "EBADNAME",
  BADFAMILY: "EBADFAMILY",
  BADRESP: "EBADRESP",
  CONNREFUSED: "ECONNREFUSED",
  TIMEOUT: "ETIMEOUT",
  EOF: "EOF",
  FILE: "EFILE",
  NOMEM: "ENOMEM",
  DESTRUCTION: "EDESTRUCTION",
  BADSTR: "EBADSTR",
  BADFLAGS: "EBADFLAGS",
  NONAME: "ENONAME",
  BADHINTS: "EBADHINTS",
  NOTINITIALIZED: "ENOTINITIALIZED",
  LOADIPHLPAPI: "ELOADIPHLPAPI",
  ADDRGETNETWORKPARAMS: "EADDRGETNETWORKPARAMS",
  CANCELLED: "ECANCELLED",
};

type ServerTriple = import("bun").dns.ServerTriple;
type NativeResolver = import("bun").dns.NativeResolver;
// What `Bun.dns` has of a native resolver.
type ResolverMethods = Omit<NativeResolver, "setLocalAddress" | "cancel">;
type ResolveCallback = (err: Error | null, result?: unknown) => void;
interface LookupAddress {
  address: string;
  family: 4 | 6;
}
// The options of `lookup()`, and what `translateLookupOptions` makes of them for `Bun.dns.lookup` (`flags`, `backend`).
interface LookupOptions {
  family?: number | string | null;
  hints?: number;
  all?: boolean;
  order?: string;
  verbatim?: boolean;
  flags?: number;
  backend?: string;
}
type LookupCallback = (err: Error | null, address?: string | LookupAddress[] | null, family?: number) => void;
type NewNativeResolver = (options: { timeout: number; tries: number }) => NativeResolver;

interface DNSException extends Error {
  errno?: number;
  syscall?: string;
  hostname?: string;
}

const IANA_DNS_PORT = 53;
const IPv6RE = /^\[([^[\]]*)\]/;
const addrSplitRE = /(^.+?)(?::(\d+))?$/;

function translateErrorCode(promise: Promise<any>) {
  return promise.catch(error => {
    return Promise.$reject(withTranslatedError(error));
  });
}

// We prefix the error codes with "DNS_" to make it clear it's a DNS error code.
// Node does not do this, so we have to translate.
function withTranslatedError(error: any) {
  const code: string | undefined = error?.code;
  if (code?.startsWith?.("DNS_")) {
    error.code = code.slice(4);
  }
  return error;
}

function getServers() {
  return dns.getServers();
}

function setServers(servers: readonly string[]) {
  return setServersOn(servers, dns);
}

const getRuntimeDefaultResultOrderOption: () => string = $bindgen(
  "dns_internals.bind.ts",
  "getRuntimeDefaultResultOrderOption",
);

function newResolver(options: { timeout: number; tries: number }) {
  if (!newResolver.native) {
    newResolver.native = $bindgen("dns_internals.bind.ts", "newResolver") as NewNativeResolver;
  }
  return newResolver.native(options);
}
declare namespace newResolver {
  export let native: NewNativeResolver | undefined;
}

function defaultResultOrder(): string {
  if (typeof defaultResultOrder.value === "undefined") {
    defaultResultOrder.value = getRuntimeDefaultResultOrderOption();
  }

  return defaultResultOrder.value;
}
declare namespace defaultResultOrder {
  export let value: string | undefined;
}

function setDefaultResultOrder(order: string) {
  validateOrder(order);
  defaultResultOrder.value = order;
}

function getDefaultResultOrder() {
  return defaultResultOrder();
}

// ares_inet_pton rejects IPv6 zone identifiers; Node's uv_inet_pton strips them.
function stripZoneId(host: string) {
  const pct = host.indexOf("%");
  return pct === -1 ? host : host.slice(0, pct);
}

function setServersOn(servers: readonly string[], object: { setServers(servers: ServerTriple[]): void }) {
  validateArray(servers, "servers");

  const triples: ServerTriple[] = [];

  servers.forEach((server, i) => {
    validateString(server, `servers[${i}]`);
    let ipVersion = isIP(server);

    if (ipVersion !== 0) {
      triples.push([ipVersion, ipVersion === 6 ? stripZoneId(server) : server, IANA_DNS_PORT]);
      return;
    }

    const match = IPv6RE.exec(server);

    // Check for an IPv6 in brackets.
    if (match) {
      ipVersion = isIP(match[1]);
      if (ipVersion !== 0) {
        const port = parseInt(addrSplitRE[Symbol.replace](server, "$2")) || IANA_DNS_PORT;
        triples.push([ipVersion, stripZoneId(match[1]), port]);
        return;
      }
    }

    // addr:port
    const addrSplitMatch = addrSplitRE.exec(server);

    if (addrSplitMatch) {
      const hostIP = addrSplitMatch[1];
      const port = addrSplitMatch[2] ? parseInt(addrSplitMatch[2]) : IANA_DNS_PORT;

      ipVersion = isIP(hostIP);

      if (ipVersion !== 0) {
        triples.push([ipVersion, hostIP, port]);
        return;
      }
    }

    throw $ERR_INVALID_IP_ADDRESS(server);
  });

  object.setServers(triples);
}

function validateFlagsOption(options: LookupOptions) {
  if (options.flags == null) {
    return;
  }

  const flags = options.flags;
  validateNumber(flags, "options.flags");

  if ((flags & ~(dns.ALL | dns.ADDRCONFIG | dns.V4MAPPED)) != 0) {
    throw $ERR_INVALID_ARG_VALUE("hints", flags, "is invalid");
  }
}

function validateFamily(family: unknown) {
  if (family !== 6 && family !== 4 && family !== 0) {
    throw $ERR_INVALID_ARG_VALUE("family", family, "must be one of 0, 4 or 6");
  }
}

function validateFamilyOption(options: LookupOptions) {
  if (options.family != null) {
    switch (options.family) {
      case "IPv4":
        options.family = 4;
        break;
      case "IPv6":
        options.family = 6;
        break;
      default:
        validateFamily(options.family);
        break;
    }
  }
}

function validateAllOption(options: LookupOptions) {
  const all = options.all;
  if (all != null) {
    validateBoolean(all, "options.all");
  }
}

function validateVerbatimOption(options: LookupOptions) {
  const verbatim = options.verbatim;
  if (verbatim != null) {
    validateBoolean(verbatim, "options.verbatim");
  }
}

function validateOrder(order: string) {
  if (!["ipv4first", "ipv6first", "verbatim"].includes(order)) {
    throw $ERR_INVALID_ARG_VALUE("order", order, "is invalid");
  }
}

function validateOrderOption(options: LookupOptions) {
  const order = options.order;
  if (order !== undefined) {
    validateOrder(order);
  }
}

// Validates and returns the callback wrapped by guardCallback.
// Callers must use the return value, not the argument.
function validateResolve(hostname: unknown, callback: ResolveCallback | undefined) {
  if (typeof hostname !== "string") {
    throw $ERR_INVALID_ARG_TYPE("hostname", "string", hostname);
  }

  if (typeof callback !== "function") {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
  }

  return guardCallback(callback);
}

function validateLocalAddresses(first: string, second?: string) {
  validateString(first, "ipv4");
  if (typeof second !== "undefined") {
    validateString(second, "ipv6");
  }
}

function invalidHostname(hostname: unknown) {
  if (invalidHostname.warned) {
    return;
  }

  invalidHostname.warned = true;
  process.emitWarning(
    `The provided hostname "${String(hostname)}" is not a valid hostname, and is supported in the dns module solely for compatibility.`,
    "DeprecationWarning",
    "DEP0118",
  );
}
declare namespace invalidHostname {
  export let warned: boolean | undefined;
}

function translateLookupOptions(options: LookupOptions | number | null | undefined): LookupOptions {
  if (!options || typeof options !== "object") {
    options = { family: options };
  }

  let { family, order, verbatim, hints: flags, all } = options;

  if (order === undefined && typeof verbatim === "boolean") {
    order = verbatim ? "verbatim" : "ipv4first";
  }

  order ??= defaultResultOrder();

  return {
    family,
    flags,
    all,
    order,
    verbatim,
    // dns.lookup()'s contract is getaddrinfo(3), so use the platform resolver, not c-ares.
    backend: "system",
  };
}

function validateLookupOptions(options: LookupOptions) {
  validateFlagsOption(options);
  validateFamilyOption(options);
  validateAllOption(options);
  validateVerbatimOption(options);
  validateOrderOption(options);
}

function lookup(
  hostname: string | null | undefined,
  // The translated options are stored back into it.
  options?: LookupOptions | number | LookupCallback | null,
  callback?: LookupCallback,
) {
  if (typeof hostname !== "string" && hostname) {
    throw $ERR_INVALID_ARG_TYPE("hostname", "string", hostname);
  }

  if (typeof options === "function") {
    callback = options;
    options = { family: 0 };
  } else if (typeof options === "number") {
    validateFunction(callback, "callback");
    validateFamily(options);
    options = { family: options };
  } else if (options !== undefined && typeof options !== "object") {
    validateFunction(arguments.length === 2 ? options : callback, "callback");
    throw $ERR_INVALID_ARG_TYPE("options", ["integer", "object"], options);
  }

  validateFunction(callback, "callback");

  options = translateLookupOptions(options);
  validateLookupOptions(options);

  if (!hostname) {
    invalidHostname(hostname);
    if (options.all) {
      callback!(null, []);
    } else {
      callback!(null, null, 4);
    }
    return;
  }

  const family = isIP(hostname);
  if (family) {
    if (options.all) {
      process.nextTick(callback!, null, [{ address: hostname, family }]);
    } else {
      process.nextTick(callback!, null, hostname, family);
    }
    return;
  }

  callback = guardCallback(callback!);
  (dns.lookup(hostname, options) as Promise<LookupAddress[]>)
    .then(res => {
      throwIfEmpty(res);

      if ((options as LookupOptions).order == "ipv4first") {
        res.sort((a, b) => a.family - b.family);
      } else if ((options as LookupOptions).order == "ipv6first") {
        res.sort((a, b) => b.family - a.family);
      }

      if ((options as LookupOptions)?.all) {
        callback!(null, res.map(mapLookupAll));
      } else {
        const [{ address, family }] = res;
        callback!(null, address, family);
      }
    })
    .catch((err: DNSException) => {
      if (err.code?.startsWith("DNS_")) err.code = err.code.slice(4);
      // Node.js getaddrinfo errors (DNSException) carry the looked-up
      // hostname both as a property and at the end of the message.
      const syscall = err.syscall;
      if (syscall === "getaddrinfo" && !err.hostname && hostname) {
        err.hostname = hostname;
        err.message = `${syscall} ${err.code} ${hostname}`;
      }
      callback!(err, undefined, undefined);
    });
}

function lookupService(
  address: string,
  port: number | string,
  callback: (err: Error | null, hostname?: string, service?: string) => void,
) {
  if (arguments.length < 3) {
    throw $ERR_MISSING_ARGS("address", "port", "callback");
  }

  if (isIP(address) === 0) {
    throw $ERR_INVALID_ARG_VALUE("address", address);
  }
  validatePort(port, "port");
  if (typeof callback !== "function") {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
  }

  callback = guardCallback(callback);
  (dns.lookupService(address, +port) as Promise<[hostname: string | undefined, service: string | undefined]>).then(
    results => {
      callback(null, ...results);
    },
    error => {
      callback(withTranslatedError(error));
    },
  );
}

function validateResolverOptions(options?: { timeout?: number; tries?: number }) {
  const { timeout = -1, tries = 4 } = { ...options };
  validateInt32(timeout, "options.timeout", -1);
  validateInt32(tries, "options.tries", 1);
  return { timeout, tries };
}

class Resolver {
  declare _handle: NativeResolver;
  #resolver: NativeResolver;

  constructor(options?: { timeout?: number; tries?: number }) {
    this.#resolver = this._handle = newResolver(validateResolverOptions(options));
  }

  cancel() {
    this.#resolver.cancel();
  }

  static #getResolver(object: object | undefined): ResolverMethods {
    return typeof object !== "undefined" && #resolver in object ? object.#resolver : dns;
  }

  getServers(this: object | undefined) {
    return Resolver.#getResolver(this).getServers() || [];
  }

  resolve(this: object | undefined, hostname: string, rrtype?: string | ResolveCallback, callback?: ResolveCallback) {
    if (typeof rrtype === "function") {
      callback = rrtype;
      rrtype = "A";
    } else if (typeof rrtype !== "string") {
      throw $ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
    }

    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolve(hostname, rrtype)
      .then(
        results => {
          switch (rrtype?.toLowerCase()) {
            case "a":
            case "aaaa":
              callback(null, results.map(mapResolveX));
              break;
            default:
              callback(null, results);
              break;
          }
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolve4(this: object | undefined, hostname: string, options?, callback?: ResolveCallback) {
    if (arguments.length <= 2) {
      callback = options;
      options = null;
    }

    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolve(hostname, "A")
      .then(
        addresses => {
          callback(null, options?.ttl ? addresses : addresses.map(mapResolveX));
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolve6(this: object | undefined, hostname: string, options?, callback?: ResolveCallback) {
    if (arguments.length <= 2) {
      callback = options;
      options = null;
    }

    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolve(hostname, "AAAA")
      .then(
        addresses => {
          callback(null, options?.ttl ? addresses : addresses.map(mapResolveX));
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolveAny(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolveAny(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolveCname(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolveCname(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolveMx(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolveMx(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolveNaptr(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolveNaptr(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolveNs(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolveNs(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolvePtr(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolvePtr(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolveSrv(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    callback = validateResolve(hostname, callback);

    Resolver.#getResolver(this)
      .resolveSrv(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolveCaa(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    callback = guardCallback(callback);

    Resolver.#getResolver(this)
      .resolveCaa(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  resolveTxt(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    callback = guardCallback(callback);

    Resolver.#getResolver(this)
      .resolveTxt(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }
  resolveSoa(this: object | undefined, hostname: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    callback = guardCallback(callback);

    Resolver.#getResolver(this)
      .resolveSoa(hostname)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  reverse(this: object | undefined, ip: string, callback: ResolveCallback) {
    if (arguments.length > 2) {
      callback = arguments[2];
    }
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    callback = guardCallback(callback);

    Resolver.#getResolver(this)
      .reverse(ip)
      .then(
        results => {
          callback(null, results);
        },
        error => {
          callback(withTranslatedError(error));
        },
      );
  }

  setLocalAddress(first: string, second?: string) {
    validateLocalAddresses(first, second);
    this.#resolver.setLocalAddress(first, second);
  }

  setServers(this: object | undefined, servers: readonly string[]) {
    return setServersOn(servers, Resolver.#getResolver(this));
  }
}

var {
  resolve,
  resolve4,
  resolve6,
  resolveAny,
  resolveCname,
  resolveCaa,
  resolveMx,
  resolveNaptr,
  resolveNs,
  resolvePtr,
  resolveSoa,
  resolveSrv,
  reverse,
  resolveTxt,
} = Resolver.prototype;

const mapLookupAll = (res: LookupAddress) => {
  const { address, family } = res;
  return { address, family };
};

function throwIfEmpty(res: unknown[]) {
  if (res.length === 0) {
    const err: DNSException = new Error("No records found");
    err.name = "DNSException";
    err.code = "ENODATA";
    // Hardcoded errno
    err.errno = 1;
    err.syscall = "getaddrinfo";
    throw err;
  }
}
Object.defineProperty(throwIfEmpty, "name", { value: "::bunternal::" });

const promisifyLookup = (order: string) => (res: LookupAddress[]) => {
  throwIfEmpty(res);
  if (order == "ipv4first") {
    res.sort((a, b) => a.family - b.family);
  } else if (order == "ipv6first") {
    res.sort((a, b) => b.family - a.family);
  }
  const [{ address, family }] = res;
  return { address, family };
};

const promisifyLookupAll = (order: string) => (res: LookupAddress[]) => {
  throwIfEmpty(res);
  if (order == "ipv4first") {
    res.sort((a, b) => a.family - b.family);
  } else if (order == "ipv6first") {
    res.sort((a, b) => b.family - a.family);
  }
  return res.map(mapLookupAll);
};

const mapResolveX = a => a.address;

const promisifyResolveX = (ttl: boolean | undefined) => {
  if (ttl) {
    return (res: unknown[]) => res;
  } else {
    return (res: unknown[]) => {
      return res?.map(mapResolveX);
    };
  }
};

// promisified versions
const promises = {
  ...errorCodes,

  lookup(hostname: string | null | undefined, options?: LookupOptions | number | null) {
    if (typeof hostname !== "string" && hostname) {
      throw $ERR_INVALID_ARG_TYPE("hostname", "string", hostname);
    }

    if (typeof options === "number") {
      validateFamily(options);
      options = { family: options };
    } else if (options !== undefined && typeof options !== "object") {
      throw $ERR_INVALID_ARG_TYPE("options", ["integer", "object"], options);
    }

    options = translateLookupOptions(options);
    validateLookupOptions(options);

    if (!hostname) {
      invalidHostname(hostname);
      return Promise.$resolve(
        options.all
          ? []
          : {
              address: null,
              family: 4,
            },
      );
    }

    const family = isIP(hostname);
    if (family) {
      const obj = { address: hostname, family };
      return Promise.$resolve(options.all ? [obj] : obj);
    }

    if (options.all) {
      return translateErrorCode(
        (dns.lookup(hostname, options) as Promise<LookupAddress[]>).then(promisifyLookupAll(options.order!)),
      );
    }
    return translateErrorCode(
      (dns.lookup(hostname, options) as Promise<LookupAddress[]>).then(promisifyLookup(options.order!)),
    );
  },

  lookupService(address: string, port: number | string) {
    if (arguments.length !== 2) {
      throw $ERR_MISSING_ARGS("address", "port");
    }

    if (isIP(address) === 0) {
      throw $ERR_INVALID_ARG_VALUE("address", address);
    }
    validatePort(port, "port");

    try {
      return translateErrorCode(dns.lookupService(address, +port)).then(([hostname, service]) => ({
        hostname,
        service,
      }));
    } catch (err) {
      if ((err as Error).name === "TypeError" || (err as Error).name === "RangeError") {
        throw err;
      }
      return Promise.$reject(withTranslatedError(err));
    }
  },

  resolve(hostname: string, rrtype?: string) {
    if (typeof hostname !== "string") {
      throw $ERR_INVALID_ARG_TYPE("hostname", "string", hostname);
    }

    if (typeof rrtype === "undefined") {
      rrtype = "A";
    } else if (typeof rrtype !== "string") {
      throw $ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
    }

    switch (rrtype?.toLowerCase()) {
      case "a":
      case "aaaa":
        return translateErrorCode((dns.resolve(hostname, rrtype) as Promise<unknown[]>).then(promisifyResolveX(false)));
      default:
        return translateErrorCode(dns.resolve(hostname, rrtype));
    }
  },

  resolve4(hostname: string, options?: { ttl?: boolean }) {
    return translateErrorCode((dns.resolve(hostname, "A") as Promise<unknown[]>).then(promisifyResolveX(options?.ttl)));
  },

  resolve6(hostname: string, options?: { ttl?: boolean }) {
    return translateErrorCode(
      (dns.resolve(hostname, "AAAA") as Promise<unknown[]>).then(promisifyResolveX(options?.ttl)),
    );
  },

  resolveAny(hostname: string) {
    return translateErrorCode(dns.resolveAny(hostname));
  },
  resolveSrv(hostname: string) {
    return translateErrorCode(dns.resolveSrv(hostname));
  },
  resolveTxt(hostname: string) {
    return translateErrorCode(dns.resolveTxt(hostname));
  },
  resolveSoa(hostname: string) {
    return translateErrorCode(dns.resolveSoa(hostname));
  },
  resolveNaptr(hostname: string) {
    return translateErrorCode(dns.resolveNaptr(hostname));
  },
  resolveMx(hostname: string) {
    return translateErrorCode(dns.resolveMx(hostname));
  },
  resolveCaa(hostname: string) {
    return translateErrorCode(dns.resolveCaa(hostname));
  },
  resolveNs(hostname: string) {
    return translateErrorCode(dns.resolveNs(hostname));
  },
  resolvePtr(hostname: string) {
    return translateErrorCode(dns.resolvePtr(hostname));
  },
  resolveCname(hostname: string) {
    return translateErrorCode(dns.resolveCname(hostname));
  },
  reverse(ip: string) {
    return translateErrorCode(dns.reverse(ip));
  },

  Resolver: class Resolver {
    declare _handle: NativeResolver;
    #resolver: NativeResolver;

    constructor(options?: { timeout?: number; tries?: number }) {
      this.#resolver = this._handle = newResolver(validateResolverOptions(options));
    }

    cancel() {
      this.#resolver.cancel();
    }

    static #getResolver(object: object | undefined): ResolverMethods {
      return typeof object !== "undefined" && #resolver in object ? object.#resolver : dns;
    }

    getServers(this: object | undefined) {
      return Resolver.#getResolver(this).getServers() || [];
    }

    resolve(this: object | undefined, hostname: string, rrtype?: string | null) {
      if (typeof rrtype === "undefined") {
        rrtype = "A";
      } else if (typeof rrtype !== "string") {
        rrtype = null;
      }
      switch (rrtype?.toLowerCase()) {
        case "a":
        case "aaaa":
          return translateErrorCode(
            Resolver.#getResolver(this).resolve(hostname, rrtype).then(promisifyResolveX(false)),
          );
        default:
          return translateErrorCode(Resolver.#getResolver(this).resolve(hostname, rrtype!));
      }
    }

    resolve4(this: object | undefined, hostname: string, options?: { ttl?: boolean }) {
      return translateErrorCode(
        Resolver.#getResolver(this).resolve(hostname, "A").then(promisifyResolveX(options?.ttl)),
      );
    }

    resolve6(this: object | undefined, hostname: string, options?: { ttl?: boolean }) {
      return translateErrorCode(
        Resolver.#getResolver(this).resolve(hostname, "AAAA").then(promisifyResolveX(options?.ttl)),
      );
    }

    resolveAny(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveAny(hostname));
    }

    resolveCname(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveCname(hostname));
    }

    resolveMx(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveMx(hostname));
    }

    resolveNaptr(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveNaptr(hostname));
    }

    resolveNs(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveNs(hostname));
    }

    resolvePtr(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolvePtr(hostname));
    }

    resolveSoa(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveSoa(hostname));
    }

    resolveSrv(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveSrv(hostname));
    }

    resolveCaa(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveCaa(hostname));
    }

    resolveTxt(this: object | undefined, hostname: string) {
      return translateErrorCode(Resolver.#getResolver(this).resolveTxt(hostname));
    }

    reverse(this: object | undefined, ip: string) {
      return translateErrorCode(Resolver.#getResolver(this).reverse(ip));
    }

    setLocalAddress(first: string, second?: string) {
      validateLocalAddresses(first, second);
      this.#resolver.setLocalAddress(first, second);
    }

    setServers(this: object | undefined, servers: readonly string[]) {
      return setServersOn(servers, Resolver.#getResolver(this));
    }
  },

  getDefaultResultOrder,
  setDefaultResultOrder,
  getServers,
  setServers,
};

// Compatibility with util.promisify(dns[method])
for (const [method, pMethod] of [
  [lookup, promises.lookup],
  [lookupService, promises.lookupService],
  [resolve, promises.resolve],
  [reverse, promises.reverse],
  [resolve4, promises.resolve4],
  [resolve6, promises.resolve6],
  [resolveAny, promises.resolveAny],
  [resolveCname, promises.resolveCname],
  [resolveCaa, promises.resolveCaa],
  [resolveMx, promises.resolveMx],
  [resolveNs, promises.resolveNs],
  [resolvePtr, promises.resolvePtr],
  [resolveSoa, promises.resolveSoa],
  [resolveSrv, promises.resolveSrv],
  [resolveTxt, promises.resolveTxt],
  [resolveNaptr, promises.resolveNaptr],
]) {
  method[utilPromisifyCustomSymbol] = pMethod;
}

export default {
  ADDRCONFIG: dns.ADDRCONFIG,
  ALL: dns.ALL,
  V4MAPPED: dns.V4MAPPED,

  // ERROR CODES
  ...errorCodes,

  lookup,
  lookupService,
  Resolver,
  setServers,
  setDefaultResultOrder,
  getDefaultResultOrder,
  resolve,
  reverse,
  resolve4,
  resolve6,
  resolveAny,
  resolveCname,
  resolveCaa,
  resolveMx,
  resolveNs,
  resolvePtr,
  resolveSoa,
  resolveSrv,
  resolveTxt,
  resolveNaptr,
  promises,
  getServers,
};
