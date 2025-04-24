// Hardcoded module "node:dns"
const dns = Bun.dns as unknown as $ZigGeneratedClasses.DNSResolver;
const utilPromisifyCustomSymbol = Symbol.for("nodejs.util.promisify.custom");
const { isIP } = require("./net");
const {
  validateFunction,
  validateArray,
  validateString,
  validateBoolean,
  validateNumber,
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

const IANA_DNS_PORT = 53;
const IPv6RE = /^\[([^[\]]*)\]/;
const addrSplitRE = /(^.+?)(?::(\d+))?$/;

// Make translateErrorCode generic to preserve promise resolution type
function translateErrorCode<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(error => {
    return Promise.reject(withTranslatedError(error));
  });
}

// We prefix the error codes with "DNS_" to make it clear it's a DNS error code.
// Node does not do this, so we have to translate.
function withTranslatedError(error: any) {
  const code = error?.code;
  if (typeof code === "string" && code.startsWith("DNS_")) {
    error.code = code.slice(4);
  }
  return error;
}

function getServers() {
  // Assume getServers returns string[] based on usage
  return dns.getServers() as string[];
}

function setServers(servers) {
  return setServersOn(servers, dns);
}

const getRuntimeDefaultResultOrderOption = $newZigFunction<() => "ipv4first" | "ipv6first" | "verbatim">(
  "dns_resolver.zig",
  "DNSResolver.getRuntimeDefaultResultOrderOption",
  0,
);

let newResolverZigFn: (options: any) => $ZigGeneratedClasses.DNSResolver;
function newResolver(options) {
  if (!newResolverZigFn) {
    newResolverZigFn = $newZigFunction("dns_resolver.zig", "DNSResolver.newResolver", 1);
  }
  return newResolverZigFn(options);
}

let defaultResultOrderValue: "ipv4first" | "ipv6first" | "verbatim" | undefined;
function defaultResultOrder() {
  if (typeof defaultResultOrderValue === "undefined") {
    defaultResultOrderValue = getRuntimeDefaultResultOrderOption();
  }

  return defaultResultOrderValue;
}

function setDefaultResultOrder(order) {
  validateOrder(order);
  defaultResultOrderValue = order;
}

function getDefaultResultOrder() {
  return defaultResultOrderValue;
}

function setServersOn(servers, object: $ZigGeneratedClasses.DNSResolver) {
  validateArray(servers, "servers");

  const triples: Array<[number, string, number]> = [];

  servers.forEach((server, i) => {
    validateString(server, `servers[${i}]`);
    let ipVersion = isIP(server);

    if (ipVersion !== 0) {
      triples.push([ipVersion, server, IANA_DNS_PORT]);
      return;
    }

    const match = IPv6RE.exec(server);

    // Check for an IPv6 in brackets.
    if (match) {
      ipVersion = isIP(match[1]);
      if (ipVersion !== 0) {
        const port = parseInt(addrSplitRE[Symbol.replace](server, "$2")!) || IANA_DNS_PORT;
        triples.push([ipVersion, match[1], port]);
        return;
      }
    }

    // addr:port
    const addrSplitMatch = addrSplitRE.exec(server);

    if (addrSplitMatch) {
      const hostIP = addrSplitMatch[1];
      const port = addrSplitMatch[2] || String(IANA_DNS_PORT);

      ipVersion = isIP(hostIP);

      if (ipVersion !== 0) {
        triples.push([ipVersion, hostIP, parseInt(port)]);
        return;
      }
    }

    throw $ERR_INVALID_IP_ADDRESS(server);
  });

  // Assume setServers returns void or similar, no need to cast return value
  object.setServers(triples);
}

function validateFlagsOption(options) {
  if (options.flags === undefined) {
    return;
  }

  validateNumber(options.flags, "flags");

  // Assume these constants exist on the dns object
  const dnsAny = dns as any;
  if ((options.flags & ~(dnsAny.ALL | dnsAny.ADDRCONFIG | dnsAny.V4MAPPED)) != 0) {
    throw $ERR_INVALID_ARG_VALUE("hints", options.flags, "is invalid");
  }
}

function validateFamily(family) {
  if (family !== 6 && family !== 4 && family !== 0) {
    throw $ERR_INVALID_ARG_VALUE("family", family, "must be one of 0, 4 or 6");
  }
}

function validateFamilyOption(options) {
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

function validateAllOption(options) {
  if (options.all !== undefined) {
    validateBoolean(options.all);
  }
}

function validateVerbatimOption(options) {
  if (options.verbatim !== undefined) {
    validateBoolean(options.verbatim);
  }
}

function validateOrder(order) {
  if (!["ipv4first", "ipv6first", "verbatim"].includes(order)) {
    throw $ERR_INVALID_ARG_VALUE("order", order, "is invalid");
  }
}

function validateOrderOption(options) {
  if (options.order !== undefined) {
    validateOrder(options.order);
  }
}

function validateResolve(hostname, callback) {
  if (typeof hostname !== "string") {
    throw $ERR_INVALID_ARG_TYPE("hostname", "string", hostname);
  }

  if (typeof callback !== "function") {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
  }
}

function validateLocalAddresses(first, second) {
  validateString(first, "first");
  if (typeof second !== "undefined") {
    validateString(second, "second");
  }
}

let invalidHostnameWarned = false;
function invalidHostname(hostname) {
  if (invalidHostnameWarned) {
    return;
  }

  invalidHostnameWarned = true;
  process.emitWarning(
    `The provided hostname "${String(hostname)}" is not a valid hostname, and is supported in the dns module solely for compatibility.`,
    "DeprecationWarning",
    "DEP0118",
  );
}

function translateLookupOptions(options) {
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
  };
}

function validateLookupOptions(options) {
  validateFlagsOption(options);
  validateFamilyOption(options);
  validateAllOption(options);
  validateVerbatimOption(options);
  validateOrderOption(options);
}

// Define expected lookup result type
type LookupResult = Array<{ address: string; family: number }>;

function lookup(hostname, options, callback) {
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
      callback(null, []);
    } else {
      callback(null, null, 4);
    }
    return;
  }

  const family = isIP(hostname);
  if (family) {
    if (options.all) {
      process.nextTick(callback, null, [{ address: hostname, family }]);
    } else {
      process.nextTick(callback, null, hostname, family);
    }
    return;
  }

  // Cast the promise immediately after the call
  // Use `as any` because the type definition might be incomplete
  const lookupPromise = (dns as any).lookup(hostname, options) as Promise<LookupResult>;

  lookupPromise.then(
    results => {
      throwIfEmpty(results);

      if (options.order == "ipv4first") {
        results.sort((a, b) => a.family - b.family);
      } else if (options.order == "ipv6first") {
        results.sort((a, b) => b.family - a.family);
      }

      if (options?.all) {
        callback(null, results.map(mapLookupAll));
      } else {
        const [{ address, family }] = results;
        callback(null, address, family);
      }
    },
    (error: any) => {
      // Handle potential errors from the promise itself or from throwIfEmpty
      callback(withTranslatedError(error));
    },
  );
}

// Define expected lookupService result type
type LookupServiceResult = [string, string];

function lookupService(address, port, callback) {
  if (arguments.length < 3) {
    throw $ERR_MISSING_ARGS("address", "port", "callback");
  }

  if (typeof callback !== "function") {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
  }

  validateString(address, "address");

  // Assume port is number or string convertible to number
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    throw $ERR_INVALID_ARG_VALUE("port", port, "must be a valid port number");
  }

  // Cast the promise immediately
  // Use `as any` because the type definition might be incomplete
  const lookupServicePromise = (dns as any).lookupService(address, portNum) as Promise<LookupServiceResult>;

  lookupServicePromise.then(
    results => {
      callback(null, ...results);
    },
    (error: any) => {
      callback(withTranslatedError(error));
    },
  );
}

function validateResolverOptions(options) {
  if (options === undefined) {
    return;
  }

  for (const key of ["timeout", "tries"]) {
    if (key in options) {
      if (typeof options[key] !== "number") {
        throw $ERR_INVALID_ARG_TYPE(key, "number", options[key]);
      }
    }
  }

  if ("timeout" in options) {
    const timeout = options.timeout;
    if ((timeout < 0 && timeout != -1) || Math.floor(timeout) != timeout || timeout >= 2 ** 31) {
      throw $ERR_OUT_OF_RANGE("timeout", "Invalid timeout", timeout);
    }
  }
}

// Define expected types for various resolve results
type ResolveAResult = Array<{ address: string; ttl?: number }>;
type ResolveAAAAResult = Array<{ address: string; ttl?: number }>;
type ResolveAnyResult = any[]; // Type varies based on records
type ResolveCnameResult = string[];
type ResolveMxResult = Array<{ exchange: string; priority: number }>;
type ResolveNaptrResult = Array<{ flags: string; service: string; regexp: string; replacement: string; order: number; preference: number }>;
type ResolveNsResult = string[];
type ResolvePtrResult = string[];
type ResolveSrvResult = Array<{ name: string; port: number; priority: number; weight: number }>;
type ResolveCaaResult = Array<{ critical: number; issue?: string; issuewild?: string; iodef?: string; contactemail?: string; contactphone?: string }>;
type ResolveTxtResult = string[][];
type ResolveSoaResult = { nsname: string; hostmaster: string; serial: number; refresh: number; retry: number; expire: number; minttl: number };
type ReverseResult = string[];

var InternalResolver = class Resolver {
  #resolver: $ZigGeneratedClasses.DNSResolver;

  constructor(options) {
    validateResolverOptions(options);
    this.#resolver = newResolver(options);
  }

  cancel() {
    this.#resolver.cancel();
  }

  static #getResolver(object?: Resolver): $ZigGeneratedClasses.DNSResolver {
    return object instanceof Resolver ? object.#resolver : dns;
  }

  getServers() {
    // Assume getServers returns string[]
    return Resolver.#getResolver(this).getServers() as string[] || [];
  }

  resolve(hostname, rrtype, callback) {
    if (typeof rrtype === "function") {
      callback = rrtype;
      rrtype = "A";
    } else if (typeof rrtype === "undefined") {
      rrtype = "A";
    } else if (typeof rrtype !== "string") {
      throw $ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
    }

    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolve(hostname, rrtype) as Promise<unknown>;

    resolvePromise.then(
      results => {
        switch (rrtype?.toLowerCase()) {
          case "a":
          case "aaaa":
            callback(null, (results as ResolveAResult | ResolveAAAAResult).map(mapResolveX));
            break;
          default:
            callback(null, results as any[]); // Cast to any[] as the type depends on rrtype
            break;
        }
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolve4(hostname, options, callback) {
    if (typeof options == "function") {
      callback = options;
      options = null;
    }

    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolve(hostname, "A") as Promise<ResolveAResult>;

    resolvePromise.then(
      addresses => {
        callback(null, options?.ttl ? addresses : addresses.map(mapResolveX));
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolve6(hostname, options, callback) {
    if (typeof options == "function") {
      callback = options;
      options = null;
    }

    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolve(hostname, "AAAA") as Promise<ResolveAAAAResult>;

    resolvePromise.then(
      addresses => {
        callback(null, options?.ttl ? addresses : addresses.map(mapResolveX));
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveAny(hostname, callback) {
    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveAny(hostname) as Promise<ResolveAnyResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveCname(hostname, callback) {
    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveCname(hostname) as Promise<ResolveCnameResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveMx(hostname, callback) {
    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveMx(hostname) as Promise<ResolveMxResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveNaptr(hostname, callback) {
    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveNaptr(hostname) as Promise<ResolveNaptrResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveNs(hostname, callback) {
    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveNs(hostname) as Promise<ResolveNsResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolvePtr(hostname, callback) {
    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolvePtr(hostname) as Promise<ResolvePtrResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveSrv(hostname, callback) {
    validateResolve(hostname, callback);

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveSrv(hostname) as Promise<ResolveSrvResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveCaa(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveCaa(hostname) as Promise<ResolveCaaResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveTxt(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveTxt(hostname) as Promise<ResolveTxtResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }
  resolveSoa(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }

    // Cast the promise immediately
    const resolvePromise = Resolver.#getResolver(this).resolveSoa(hostname) as Promise<ResolveSoaResult>;

    resolvePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  reverse(ip, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }

    // Cast the promise immediately
    const reversePromise = Resolver.#getResolver(this).reverse(ip) as Promise<ReverseResult>;

    reversePromise.then(
      results => {
        callback(null, results);
      },
      (error: any) => {
        callback(withTranslatedError(error));
      },
    );
  }

  setLocalAddress(first, second) {
    validateLocalAddresses(first, second);
    // Assume setLocalAddress returns void or similar
    Resolver.#getResolver(this).setLocalAddress(first, second);
  }

  setServers(servers) {
    return setServersOn(servers, Resolver.#getResolver(this));
  }
};

function Resolver(options) {
  return new InternalResolver(options);
}
Resolver.prototype = {};
Object.setPrototypeOf(Resolver.prototype, InternalResolver.prototype);
Object.setPrototypeOf(Resolver, InternalResolver);

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
} = InternalResolver.prototype;

const mapLookupAll = (res: { address: string; family: number }) => {
  const { address, family } = res;
  return { address, family };
};

function throwIfEmpty(res: unknown) {
  if (!Array.isArray(res) || res.length === 0) {
    const err = new Error("No records found") as Error & {
      name: string;
      code: string;
      errno: number;
      syscall: string;
    };
    err.name = "DNSException";
    err.code = "ENODATA";
    // Hardcoded errno
    err.errno = 1;
    err.syscall = "getaddrinfo";
    throw err;
  }
}
Object.defineProperty(throwIfEmpty, "name", { value: "::bunternal::" });

const promisifyLookup = order => (results: LookupResult) => {
  throwIfEmpty(results);
  if (order == "ipv4first") {
    results.sort((a, b) => a.family - b.family);
  } else if (order == "ipv6first") {
    results.sort((a, b) => b.family - a.family);
  }
  const [{ address, family }] = results;
  return { address, family };
};

const promisifyLookupAll = order => (results: LookupResult) => {
  throwIfEmpty(results);
  if (order == "ipv4first") {
    results.sort((a, b) => a.family - b.family);
  } else if (order == "ipv6first") {
    results.sort((a, b) => b.family - a.family);
  }
  return results.map(mapLookupAll);
};

const mapResolveX = (a: { address: string; ttl?: number }) => a.address;

const promisifyResolveX = ttl => {
  if (ttl) {
    return (res: ResolveAResult | ResolveAAAAResult) => res;
  } else {
    return (res: ResolveAResult | ResolveAAAAResult) => {
      return res?.map(mapResolveX);
    };
  }
};

// promisified versions
const promises = {
  ...errorCodes,

  lookup(hostname, options) {
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
      return Promise.resolve(
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
      return Promise.resolve(options.all ? [obj] : obj);
    }

    // Cast the promise immediately
    // Use `as any` because the type definition might be incomplete
    const lookupPromise = (dns as any).lookup(hostname, options) as Promise<LookupResult>;

    if (options.all) {
      return translateErrorCode(lookupPromise.then(res => promisifyLookupAll(options.order)(res)));
    }
    return translateErrorCode(lookupPromise.then(res => promisifyLookup(options.order)(res)));
  },

  lookupService(address, port) {
    if (arguments.length !== 2) {
      throw $ERR_MISSING_ARGS("address", "port");
    }

    validateString(address, "address");
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
      throw $ERR_INVALID_ARG_VALUE("port", port, "must be a valid port number");
    }

    try {
      // Cast the promise immediately
      // Use `as any` because the type definition might be incomplete
      const lookupServicePromise = (dns as any).lookupService(address, portNum) as Promise<LookupServiceResult>;
      return translateErrorCode(lookupServicePromise).then(
        results => {
          const [hostname, service] = results;
          return {
            hostname,
            service,
          };
        },
      );
    } catch (err: any) {
      if (err.name === "TypeError" || err.name === "RangeError") {
        throw err;
      }
      return Promise.reject(withTranslatedError(err));
    }
  },

  resolve(hostname, rrtype) {
    if (typeof hostname !== "string") {
      throw $ERR_INVALID_ARG_TYPE("hostname", "string", hostname);
    }

    if (typeof rrtype === "undefined") {
      rrtype = "A";
    } else if (typeof rrtype !== "string") {
      throw $ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
    }

    // Cast the promise immediately
    const resolvePromise = dns.resolve(hostname, rrtype) as Promise<unknown>;

    switch (rrtype?.toLowerCase()) {
      case "a":
      case "aaaa":
        return translateErrorCode(
          (resolvePromise as Promise<ResolveAResult | ResolveAAAAResult>).then(res => {
            return promisifyResolveX(false)(res);
          }),
        );
      default:
        return translateErrorCode(resolvePromise as Promise<any[]>); // Type depends on rrtype
    }
  },

  resolve4(hostname, options) {
    // Cast the promise immediately
    const resolvePromise = dns.resolve(hostname, "A") as Promise<ResolveAResult>;
    return translateErrorCode(
      resolvePromise.then(res => {
        return promisifyResolveX(options?.ttl)(res);
      }),
    );
  },

  resolve6(hostname, options) {
    // Cast the promise immediately
    const resolvePromise = dns.resolve(hostname, "AAAA") as Promise<ResolveAAAAResult>;
    return translateErrorCode(
      resolvePromise.then(res => {
        return promisifyResolveX(options?.ttl)(res);
      }),
    );
  },

  resolveAny(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveAny(hostname) as Promise<ResolveAnyResult>;
    return translateErrorCode(resolvePromise);
  },
  resolveSrv(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveSrv(hostname) as Promise<ResolveSrvResult>;
    return translateErrorCode(resolvePromise);
  },
  resolveTxt(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveTxt(hostname) as Promise<ResolveTxtResult>;
    return translateErrorCode(resolvePromise);
  },
  resolveSoa(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveSoa(hostname) as Promise<ResolveSoaResult>;
    return translateErrorCode(resolvePromise);
  },
  resolveNaptr(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveNaptr(hostname) as Promise<ResolveNaptrResult>;
    return translateErrorCode(resolvePromise);
  },
  resolveMx(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveMx(hostname) as Promise<ResolveMxResult>;
    return translateErrorCode(resolvePromise);
  },
  resolveCaa(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveCaa(hostname) as Promise<ResolveCaaResult>;
    return translateErrorCode(resolvePromise);
  },
  resolveNs(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveNs(hostname) as Promise<ResolveNsResult>;
    return translateErrorCode(resolvePromise);
  },
  resolvePtr(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolvePtr(hostname) as Promise<ResolvePtrResult>;
    return translateErrorCode(resolvePromise);
  },
  resolveCname(hostname) {
    // Cast the promise immediately
    const resolvePromise = dns.resolveCname(hostname) as Promise<ResolveCnameResult>;
    return translateErrorCode(resolvePromise);
  },
  reverse(ip) {
    // Cast the promise immediately
    const reversePromise = dns.reverse(ip) as Promise<ReverseResult>;
    return translateErrorCode(reversePromise);
  },

  Resolver: class Resolver {
    #resolver: $ZigGeneratedClasses.DNSResolver;

    constructor(options) {
      validateResolverOptions(options);
      this.#resolver = newResolver(options);
    }

    cancel() {
      this.#resolver.cancel();
    }

    static #getResolver(object?: Resolver): $ZigGeneratedClasses.DNSResolver {
      return object instanceof Resolver ? object.#resolver : dns;
    }

    getServers() {
      // Assume getServers returns string[]
      return Resolver.#getResolver(this).getServers() as string[] || [];
    }

    resolve(hostname, rrtype) {
      if (typeof rrtype === "undefined") {
        rrtype = "A";
      } else if (typeof rrtype !== "string") {
        throw $ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
      }

      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolve(hostname, rrtype) as Promise<unknown>;

      switch (rrtype?.toLowerCase()) {
        case "a":
        case "aaaa":
          return translateErrorCode(
            (resolvePromise as Promise<ResolveAResult | ResolveAAAAResult>).then(res => {
              return promisifyResolveX(false)(res);
            }),
          );
        default:
          return translateErrorCode(resolvePromise as Promise<any[]>); // Type depends on rrtype
      }
    }

    resolve4(hostname, options) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolve(hostname, "A") as Promise<ResolveAResult>;
      return translateErrorCode(
        resolvePromise.then(res => {
          return promisifyResolveX(options?.ttl)(res);
        }),
      );
    }

    resolve6(hostname, options) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolve(hostname, "AAAA") as Promise<ResolveAAAAResult>;
      return translateErrorCode(
        resolvePromise.then(res => {
          return promisifyResolveX(options?.ttl)(res);
        }),
      );
    }

    resolveAny(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveAny(hostname) as Promise<ResolveAnyResult>;
      return translateErrorCode(resolvePromise);
    }

    resolveCname(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveCname(hostname) as Promise<ResolveCnameResult>;
      return translateErrorCode(resolvePromise);
    }

    resolveMx(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveMx(hostname) as Promise<ResolveMxResult>;
      return translateErrorCode(resolvePromise);
    }

    resolveNaptr(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveNaptr(hostname) as Promise<ResolveNaptrResult>;
      return translateErrorCode(resolvePromise);
    }

    resolveNs(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveNs(hostname) as Promise<ResolveNsResult>;
      return translateErrorCode(resolvePromise);
    }

    resolvePtr(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolvePtr(hostname) as Promise<ResolvePtrResult>;
      return translateErrorCode(resolvePromise);
    }

    resolveSoa(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveSoa(hostname) as Promise<ResolveSoaResult>;
      return translateErrorCode(resolvePromise);
    }

    resolveSrv(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveSrv(hostname) as Promise<ResolveSrvResult>;
      return translateErrorCode(resolvePromise);
    }

    resolveCaa(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveCaa(hostname) as Promise<ResolveCaaResult>;
      return translateErrorCode(resolvePromise);
    }

    resolveTxt(hostname) {
      // Cast the promise immediately
      const resolvePromise = Resolver.#getResolver(this).resolveTxt(hostname) as Promise<ResolveTxtResult>;
      return translateErrorCode(resolvePromise);
    }

    reverse(ip) {
      // Cast the promise immediately
      const reversePromise = Resolver.#getResolver(this).reverse(ip) as Promise<ReverseResult>;
      return translateErrorCode(reversePromise);
    }

    setLocalAddress(first, second) {
      validateLocalAddresses(first, second);
      // Assume setLocalAddress returns void or similar
      Resolver.#getResolver(this).setLocalAddress(first, second);
    }

    setServers(servers) {
      return setServersOn(servers, Resolver.#getResolver(this));
    }
  },

  setDefaultResultOrder,
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
  (method as any)[utilPromisifyCustomSymbol] = pMethod;
}

// Assume these constants exist on the dns object
const dnsAny = dns as any;

export default {
  ADDRCONFIG: dnsAny.ADDRCONFIG,
  ALL: dnsAny.ALL,
  V4MAPPED: dnsAny.V4MAPPED,

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