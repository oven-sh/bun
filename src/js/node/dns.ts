// Hardcoded module "node:dns"
const dns = Bun.dns;
const utilPromisifyCustomSymbol = Symbol.for("nodejs.util.promisify.custom");
const { isIP } = require("internal/net/isIP");
const { hasObserver, startPerf, stopPerf } = require("internal/shared");
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

function translateErrorCode(promise: Promise<any>) {
  return promise.catch(error => {
    return Promise.$reject(withTranslatedError(error));
  });
}

// We prefix the error codes with "DNS_" to make it clear it's a DNS error code.
// Node does not do this, so we have to translate.
function withTranslatedError(error: any) {
  const code = error?.code;
  if (code?.startsWith?.("DNS_")) {
    error.code = code.slice(4);
  }
  return error;
}

function getServers() {
  return dns.getServers();
}

function setServers(servers) {
  return setServersOn(servers, dns);
}

const getRuntimeDefaultResultOrderOption = $newRustFunction(
  "runtime/dns_jsc/dns.rs",
  "Resolver.getRuntimeDefaultResultOrderOption",
  0,
);

function newResolver(options) {
  if (!newResolver.native) {
    newResolver.native = $newRustFunction("runtime/dns_jsc/dns.rs", "Resolver.newResolver", 1);
  }
  return newResolver.native(options);
}

function defaultResultOrder() {
  if (typeof defaultResultOrder.value === "undefined") {
    defaultResultOrder.value = getRuntimeDefaultResultOrderOption();
  }

  return defaultResultOrder.value;
}

function setDefaultResultOrder(order) {
  validateOrder(order);
  defaultResultOrder.value = order;
}

function getDefaultResultOrder() {
  return defaultResultOrder();
}

function setServersOn(servers, object) {
  validateArray(servers, "servers");

  const triples = [];

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
        const port = parseInt(addrSplitRE[Symbol.replace](server, "$2")) || IANA_DNS_PORT;
        triples.push([ipVersion, match[1], port]);
        return;
      }
    }

    // addr:port
    const addrSplitMatch = addrSplitRE.exec(server);

    if (addrSplitMatch) {
      const hostIP = addrSplitMatch[1];
      const port = addrSplitMatch[2] || IANA_DNS_PORT;

      ipVersion = isIP(hostIP);

      if (ipVersion !== 0) {
        triples.push([ipVersion, hostIP, parseInt(port)]);
        return;
      }
    }

    throw $ERR_INVALID_IP_ADDRESS(server);
  });

  object.setServers(triples);
}

function validateFlagsOption(options) {
  if (options.flags === undefined) {
    return;
  }

  const flags = options.flags;
  validateNumber(flags);

  if ((flags & ~(dns.ALL | dns.ADDRCONFIG | dns.V4MAPPED)) != 0) {
    throw $ERR_INVALID_ARG_VALUE("hints", flags, "is invalid");
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
  const all = options.all;
  if (all !== undefined) {
    validateBoolean(all);
  }
}

function validateVerbatimOption(options) {
  const verbatim = options.verbatim;
  if (verbatim !== undefined) {
    validateBoolean(verbatim);
  }
}

function validateOrder(order) {
  if (!["ipv4first", "ipv6first", "verbatim"].includes(order)) {
    throw $ERR_INVALID_ARG_VALUE("order", order, "is invalid");
  }
}

function validateOrderOption(options) {
  const order = options.order;
  if (order !== undefined) {
    validateOrder(order);
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
  validateString(first);
  if (typeof second !== "undefined") {
    validateString(second);
  }
}

function invalidHostname(hostname) {
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

// node:perf_hooks 'dns' entries. As in Node, an entry is recorded only when
// the resolver operation was dispatched and completed successfully; each
// helper wraps the native promise and is free when nothing observes 'dns'.
const kPerfEntry = Symbol("kPerfEntry");

// Detail fields mirror lib/dns.js `lookup`:
// https://github.com/nodejs/node/blob/v25.2.1/lib/dns.js#L229-L248
function observeLookup(hostname, options, promise) {
  if (!hasObserver("dns")) return promise;
  const ctx = {};
  startPerf(ctx, kPerfEntry, {
    type: "dns",
    name: "lookup",
    detail: {
      hostname,
      family: options.family ?? 0,
      hints: options.flags ?? 0,
      verbatim: options.order === "verbatim",
      order: options.order,
    },
  });
  return promise.then(res => {
    // An empty result reaches the caller as ENODATA (see throwIfEmpty), so it
    // records nothing, like every other failed lookup. The addresses are
    // recorded in the shape and order the caller receives them.
    if (res.length) {
      sortByOrder(res, options.order);
      const addresses = options.all ? res.map(mapLookupAll) : res.map(mapResolveX);
      stopPerf(ctx, kPerfEntry, { detail: { addresses } });
    }
    return res;
  });
}

// https://github.com/nodejs/node/blob/v25.2.1/lib/dns.js#L255-L296
function observeLookupService(host, port, promise) {
  if (!hasObserver("dns")) return promise;
  const ctx = {};
  startPerf(ctx, kPerfEntry, { type: "dns", name: "lookupService", detail: { host, port } });
  return promise.then(res => {
    // The native lookupService promise resolves with a [hostname, service] pair.
    stopPerf(ctx, kPerfEntry, { detail: { hostname: res[0], service: res[1] } });
    return res;
  });
}

// `name` is Node's c-ares binding (and entry) name for the operation, e.g.
// resolve4 -> "queryA", reverse -> "getHostByAddr". `detail.result` records
// the promise's value, so callers pass the promise the user will observe:
// https://github.com/nodejs/node/blob/v25.2.1/lib/internal/dns/promises.js#L288-L330
function observeQuery(name, host, promise, ttl?) {
  if (!hasObserver("dns")) return promise;
  const ctx = {};
  startPerf(ctx, kPerfEntry, { type: "dns", name, detail: { host, ttl: !!ttl } });
  return promise.then(result => {
    stopPerf(ctx, kPerfEntry, { detail: { result } });
    return result;
  });
}

// resolve(hostname, "MX") records the same entry name as resolveMx():
// https://github.com/nodejs/node/blob/v25.2.1/lib/internal/dns/utils.js#L293-L307
function queryNameFor(rrtype) {
  rrtype = "" + rrtype;
  return "query" + rrtype.charAt(0).toUpperCase() + rrtype.slice(1).toLowerCase();
}

// Applies the requested result order to `res` in place and returns it.
// Re-applying it is a no-op, so observeLookup may run it before the caller.
function sortByOrder(res, order) {
  if (order == "ipv4first") {
    res.sort((a, b) => a.family - b.family);
  } else if (order == "ipv6first") {
    res.sort((a, b) => b.family - a.family);
  }
  return res;
}

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

  observeLookup(hostname, options, dns.lookup(hostname, options))
    .then(res => {
      throwIfEmpty(res);

      sortByOrder(res, options.order);

      if (options?.all) {
        callback(null, res.map(mapLookupAll));
      } else {
        const [{ address, family }] = res;
        callback(null, address, family);
      }
    })
    .catch(err => {
      if (err.code?.startsWith("DNS_")) err.code = err.code.slice(4);
      // Node.js getaddrinfo errors (DNSException) carry the looked-up
      // hostname both as a property and at the end of the message.
      const syscall = err.syscall;
      if (syscall === "getaddrinfo" && !err.hostname && hostname) {
        err.hostname = hostname;
        err.message = `${syscall} ${err.code} ${hostname}`;
      }
      callback(err, undefined, undefined);
    });
}

function lookupService(address, port, callback) {
  if (arguments.length < 3) {
    throw $ERR_MISSING_ARGS("address", "port", "callback");
  }

  if (typeof callback !== "function") {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
  }

  validateString(address);

  observeLookupService(address, port, dns.lookupService(address, port)).then(
    results => {
      callback(null, ...results);
    },
    error => {
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

var InternalResolver = class Resolver {
  #resolver;

  constructor(options) {
    validateResolverOptions(options);
    this.#resolver = this._handle = newResolver(options);
  }

  cancel() {
    this.#resolver.cancel();
  }

  static #getResolver(object) {
    return typeof object !== "undefined" && #resolver in object ? object.#resolver : dns;
  }

  getServers() {
    return Resolver.#getResolver(this).getServers() || [];
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

    let query = Resolver.#getResolver(this).resolve(hostname, rrtype);
    switch (rrtype?.toLowerCase()) {
      case "a":
      case "aaaa":
        query = query.then(promisifyResolveX(false));
        break;
    }
    observeQuery(queryNameFor(rrtype), hostname, query).then(
      results => {
        callback(null, results);
      },
      error => {
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

    observeQuery(
      "queryA",
      hostname,
      Resolver.#getResolver(this).resolve(hostname, "A").then(promisifyResolveX(options?.ttl)),
      options?.ttl,
    ).then(
      addresses => {
        callback(null, addresses);
      },
      error => {
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

    observeQuery(
      "queryAaaa",
      hostname,
      Resolver.#getResolver(this).resolve(hostname, "AAAA").then(promisifyResolveX(options?.ttl)),
      options?.ttl,
    ).then(
      addresses => {
        callback(null, addresses);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveAny(hostname, callback) {
    validateResolve(hostname, callback);

    observeQuery("queryAny", hostname, Resolver.#getResolver(this).resolveAny(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveCname(hostname, callback) {
    validateResolve(hostname, callback);

    observeQuery("queryCname", hostname, Resolver.#getResolver(this).resolveCname(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveMx(hostname, callback) {
    validateResolve(hostname, callback);

    observeQuery("queryMx", hostname, Resolver.#getResolver(this).resolveMx(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveNaptr(hostname, callback) {
    validateResolve(hostname, callback);

    observeQuery("queryNaptr", hostname, Resolver.#getResolver(this).resolveNaptr(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveNs(hostname, callback) {
    validateResolve(hostname, callback);

    observeQuery("queryNs", hostname, Resolver.#getResolver(this).resolveNs(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolvePtr(hostname, callback) {
    validateResolve(hostname, callback);

    observeQuery("queryPtr", hostname, Resolver.#getResolver(this).resolvePtr(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveSrv(hostname, callback) {
    validateResolve(hostname, callback);

    observeQuery("querySrv", hostname, Resolver.#getResolver(this).resolveSrv(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveCaa(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }

    observeQuery("queryCaa", hostname, Resolver.#getResolver(this).resolveCaa(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  resolveTxt(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }

    observeQuery("queryTxt", hostname, Resolver.#getResolver(this).resolveTxt(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }
  resolveSoa(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }

    observeQuery("querySoa", hostname, Resolver.#getResolver(this).resolveSoa(hostname)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  reverse(ip, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }

    observeQuery("getHostByAddr", ip, Resolver.#getResolver(this).reverse(ip)).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
  }

  setLocalAddress(first, second) {
    validateLocalAddresses(first, second);
    Resolver.#getResolver(this).setLocalAddress(first, second);
  }

  setServers(servers) {
    return setServersOn(servers, Resolver.#getResolver(this));
  }
};

function Resolver(options) {
  return new InternalResolver(options);
}
$toClass(Resolver, "Resolver", InternalResolver);

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

const mapLookupAll = res => {
  const { address, family } = res;
  return { address, family };
};

function throwIfEmpty(res) {
  if (res.length === 0) {
    const err = new Error("No records found");
    err.name = "DNSException";
    err.code = "ENODATA";
    // Hardcoded errno
    err.errno = 1;
    err.syscall = "getaddrinfo";
    throw err;
  }
}
Object.defineProperty(throwIfEmpty, "name", { value: "::bunternal::" });

const promisifyLookup = order => res => {
  throwIfEmpty(res);
  sortByOrder(res, order);
  const [{ address, family }] = res;
  return { address, family };
};

const promisifyLookupAll = order => res => {
  throwIfEmpty(res);
  sortByOrder(res, order);
  return res.map(mapLookupAll);
};

const mapResolveX = a => a.address;

const promisifyResolveX = ttl => {
  if (ttl) {
    return res => res;
  } else {
    return res => {
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

    const res = observeLookup(hostname, options, dns.lookup(hostname, options));
    if (options.all) {
      return translateErrorCode(res.then(promisifyLookupAll(options.order)));
    }
    return translateErrorCode(res.then(promisifyLookup(options.order)));
  },

  lookupService(address, port) {
    if (arguments.length !== 2) {
      throw $ERR_MISSING_ARGS("address", "port");
    }

    validateString(address);

    try {
      return translateErrorCode(observeLookupService(address, port, dns.lookupService(address, port))).then(
        ([hostname, service]) => ({
          hostname,
          service,
        }),
      );
    } catch (err) {
      if (err.name === "TypeError" || err.name === "RangeError") {
        throw err;
      }
      return Promise.$reject(withTranslatedError(err));
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

    let query = dns.resolve(hostname, rrtype);
    switch (rrtype?.toLowerCase()) {
      case "a":
      case "aaaa":
        query = query.then(promisifyResolveX(false));
        break;
    }
    return translateErrorCode(observeQuery(queryNameFor(rrtype), hostname, query));
  },

  resolve4(hostname, options) {
    return translateErrorCode(
      observeQuery("queryA", hostname, dns.resolve(hostname, "A").then(promisifyResolveX(options?.ttl)), options?.ttl),
    );
  },

  resolve6(hostname, options) {
    return translateErrorCode(
      observeQuery(
        "queryAaaa",
        hostname,
        dns.resolve(hostname, "AAAA").then(promisifyResolveX(options?.ttl)),
        options?.ttl,
      ),
    );
  },

  resolveAny(hostname) {
    return translateErrorCode(observeQuery("queryAny", hostname, dns.resolveAny(hostname)));
  },
  resolveSrv(hostname) {
    return translateErrorCode(observeQuery("querySrv", hostname, dns.resolveSrv(hostname)));
  },
  resolveTxt(hostname) {
    return translateErrorCode(observeQuery("queryTxt", hostname, dns.resolveTxt(hostname)));
  },
  resolveSoa(hostname) {
    return translateErrorCode(observeQuery("querySoa", hostname, dns.resolveSoa(hostname)));
  },
  resolveNaptr(hostname) {
    return translateErrorCode(observeQuery("queryNaptr", hostname, dns.resolveNaptr(hostname)));
  },
  resolveMx(hostname) {
    return translateErrorCode(observeQuery("queryMx", hostname, dns.resolveMx(hostname)));
  },
  resolveCaa(hostname) {
    return translateErrorCode(observeQuery("queryCaa", hostname, dns.resolveCaa(hostname)));
  },
  resolveNs(hostname) {
    return translateErrorCode(observeQuery("queryNs", hostname, dns.resolveNs(hostname)));
  },
  resolvePtr(hostname) {
    return translateErrorCode(observeQuery("queryPtr", hostname, dns.resolvePtr(hostname)));
  },
  resolveCname(hostname) {
    return translateErrorCode(observeQuery("queryCname", hostname, dns.resolveCname(hostname)));
  },
  reverse(ip) {
    return translateErrorCode(observeQuery("getHostByAddr", ip, dns.reverse(ip)));
  },

  Resolver: class Resolver {
    #resolver;

    constructor(options) {
      validateResolverOptions(options);
      this.#resolver = this._handle = newResolver(options);
    }

    cancel() {
      this.#resolver.cancel();
    }

    static #getResolver(object) {
      return typeof object !== "undefined" && #resolver in object ? object.#resolver : dns;
    }

    getServers() {
      return Resolver.#getResolver(this).getServers() || [];
    }

    resolve(hostname, rrtype) {
      if (typeof rrtype === "undefined") {
        rrtype = "A";
      } else if (typeof rrtype !== "string") {
        rrtype = null;
      }
      let query = Resolver.#getResolver(this).resolve(hostname, rrtype);
      switch (rrtype?.toLowerCase()) {
        case "a":
        case "aaaa":
          query = query.then(promisifyResolveX(false));
          break;
      }
      // The native resolver treats the null rrtype above as an A query.
      return translateErrorCode(observeQuery(queryNameFor(rrtype ?? "A"), hostname, query));
    }

    resolve4(hostname, options) {
      return translateErrorCode(
        observeQuery(
          "queryA",
          hostname,
          Resolver.#getResolver(this).resolve(hostname, "A").then(promisifyResolveX(options?.ttl)),
          options?.ttl,
        ),
      );
    }

    resolve6(hostname, options) {
      return translateErrorCode(
        observeQuery(
          "queryAaaa",
          hostname,
          Resolver.#getResolver(this).resolve(hostname, "AAAA").then(promisifyResolveX(options?.ttl)),
          options?.ttl,
        ),
      );
    }

    resolveAny(hostname) {
      return translateErrorCode(observeQuery("queryAny", hostname, Resolver.#getResolver(this).resolveAny(hostname)));
    }

    resolveCname(hostname) {
      return translateErrorCode(
        observeQuery("queryCname", hostname, Resolver.#getResolver(this).resolveCname(hostname)),
      );
    }

    resolveMx(hostname) {
      return translateErrorCode(observeQuery("queryMx", hostname, Resolver.#getResolver(this).resolveMx(hostname)));
    }

    resolveNaptr(hostname) {
      return translateErrorCode(
        observeQuery("queryNaptr", hostname, Resolver.#getResolver(this).resolveNaptr(hostname)),
      );
    }

    resolveNs(hostname) {
      return translateErrorCode(observeQuery("queryNs", hostname, Resolver.#getResolver(this).resolveNs(hostname)));
    }

    resolvePtr(hostname) {
      return translateErrorCode(observeQuery("queryPtr", hostname, Resolver.#getResolver(this).resolvePtr(hostname)));
    }

    resolveSoa(hostname) {
      return translateErrorCode(observeQuery("querySoa", hostname, Resolver.#getResolver(this).resolveSoa(hostname)));
    }

    resolveSrv(hostname) {
      return translateErrorCode(observeQuery("querySrv", hostname, Resolver.#getResolver(this).resolveSrv(hostname)));
    }

    resolveCaa(hostname) {
      return translateErrorCode(observeQuery("queryCaa", hostname, Resolver.#getResolver(this).resolveCaa(hostname)));
    }

    resolveTxt(hostname) {
      return translateErrorCode(observeQuery("queryTxt", hostname, Resolver.#getResolver(this).resolveTxt(hostname)));
    }

    reverse(ip) {
      return translateErrorCode(observeQuery("getHostByAddr", ip, Resolver.#getResolver(this).reverse(ip)));
    }

    setLocalAddress(first, second) {
      validateLocalAddresses(first, second);
      Resolver.#getResolver(this).setLocalAddress(first, second);
    }

    setServers(servers) {
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
