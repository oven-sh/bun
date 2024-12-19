// Hardcoded module "node:dns"
const dns = Bun.dns;
const utilPromisifyCustomSymbol = Symbol.for("nodejs.util.promisify.custom");
const { isIP } = require("./net");
const {
  validateFunction,
  validateAbortSignal,
  validateArray,
  validateString,
  validateBoolean,
  validateInteger,
  validateUint32,
  validateNumber,
} = require("internal/validators");

const { ERR_INVALID_IP_ADDRESS } = require("internal/errors");

const IANA_DNS_PORT = 53;
const IPv6RE = /^\[([^[\]]*)\]/;
const addrSplitRE = /(^.+?)(?::(\d+))?$/;

function translateErrorCode(promise: Promise<any>) {
  return promise.catch(error => {
    return Promise.reject(withTranslatedError(error));
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

    throw ERR_INVALID_IP_ADDRESS(server);
  });

  object.setServers(triples);
}

function lookup(domain, options, callback) {
  if (typeof options == "function") {
    callback = options;
  }

  if (typeof callback !== "function") {
    throw $ERR_INVALID_ARG_TYPE("callback must be a function");
  }

  if (typeof options == "number") {
    options = { family: options };
  }

  if (domain !== domain || (typeof domain !== "number" && !domain)) {
    console.warn(
      `DeprecationWarning: The provided hostname "${String(
        domain,
      )}" is not a valid hostname, and is supported in the dns module solely for compatibility.`,
    );
    callback(null, null, 4);
    return;
  }

  dns.lookup(domain, translateLookupOptions(options)).then(res => {
    throwIfEmpty(res);
    res.sort((a, b) => a.family - b.family);

    if (options?.all) {
      callback(null, res.map(mapLookupAll));
    } else {
      const [{ address, family }] = res;
      callback(null, address, family);
    }
  }, callback);
}

function lookupService(address, port, callback) {
  if (arguments.length !== 3) {
    throw $ERR_MISSING_ARGS('The "address", "port", and "callback" arguments must be specified');
  }

  if (typeof callback !== "function") {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
  }

  dns.lookupService(address, port).then(
    results => {
      callback(null, ...results);
    },
    error => {
      callback(withTranslatedError(error));
    },
  );
}

var InternalResolver = class Resolver {
  #resolver;

  constructor(options) {
    this.#resolver = dns.newResolver();
  }

  cancel() {}

  static #getResolver(object) {
    return #resolver in object ? object.#resolver : dns;
  }

  getServers() {
    return Resolver.#getResolver(this).getServers();
  }

  resolve(hostname, rrtype, callback) {
    if (typeof rrtype == "function") {
      callback = rrtype;
      rrtype = null;
    } else if (typeof rrtype != "string") {
      throw $ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
    }

    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

    Resolver.#getResolver(this)
      .resolve(hostname)
      .then(
        results => {
          switch (rrtype?.toLowerCase()) {
            case "a":
            case "aaaa":
              callback(null, hostname, results.map(mapResolveX));
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

  resolve4(hostname, options, callback) {
    if (typeof options == "function") {
      callback = options;
      options = null;
    }

    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolve6(hostname, options, callback) {
    if (typeof options == "function") {
      callback = options;
      options = null;
    }

    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolveAny(hostname, callback) {
    const resolver = Resolver.#getResolver(this);
    let results = undefined;
    let error = null;
    const methods = [
      ["resolve", "A", "A"],
      ["resolve", "AAAA", "AAAA"],
      ["resolveCaa", "CAA"],
      ["resolveCname", "CNAME"],
      ["resolveMx", "MX"],
      ["resolveNs", "NS"],
      ["resolvePtr", "PTR"],
      ["resolveSoa", "SOA"],
      ["resolveSrv", "SRV"],
      ["resolveTxt", "TXT"],
    ];

    Promise.all(
      methods.map(([method, type, ...args]) =>
        resolver[method](hostname, ...args)
          .then(records => {
            results = (results || []).concat(
              (Array.isArray(records) ? records : [records]).map(record => Object.assign(record, { type })),
            );
          })
          .catch(err => (error = err)),
      ),
    ).finally(() => {
      if (error) {
        error.syscall = "queryAny";
      }
      callback(results ? null : error, results);
    });
  }

  resolveCname(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolveMx(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolveNaptr(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolveNs(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolvePtr(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolveSrv(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolveCaa(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  resolveTxt(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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
  resolveSoa(hostname, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

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

  reverse(ip, callback) {
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", typeof callback);
    }

    dns.reverse(ip).then(
      results => {
        callback(null, results);
      },
      error => {
        callback(withTranslatedError(error));
      },
    );
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

function setDefaultResultOrder() {}

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

const promisifyLookup = res => {
  throwIfEmpty(res);
  res.sort((a, b) => a.family - b.family);
  const [{ address, family }] = res;
  return { address, family };
};

const promisifyLookupAll = res => {
  throwIfEmpty(res);
  res.sort((a, b) => a.family - b.family);
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

const translateLookupOptions = ({ family, order, verbatim, hints: flags, all }) => ({
  family,
  flags,
  all,
  order,
  verbatim,
});

// promisified versions
const promises = {
  lookup(domain, options) {
    if (!options || typeof options !== "object") {
      options = {};
    }

    options = translateLookupOptions(options);

    if (options.all) {
      return translateErrorCode(dns.lookup(domain, options).then(promisifyLookupAll));
    }
    return translateErrorCode(dns.lookup(domain, options).then(promisifyLookup));
  },

  lookupService(address, port) {
    if (arguments.length !== 2) {
      throw $ERR_MISSING_ARGS('The "address" and "port" arguments must be specified');
    }
    return translateErrorCode(dns.lookupService(address, port));
  },

  resolve(hostname, rrtype) {
    if (typeof hostname !== "string") {
      throw $ERR_INVALID_ARG_TYPE("hostname", "string", hostname);
    }
    if (typeof rrtype !== "string") {
      throw $ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
    }
    switch (rrtype?.toLowerCase()) {
      case "a":
      case "aaaa":
        return translateErrorCode(dns.resolve(hostname, rrtype).then(promisifyLookup));
      default:
        return translateErrorCode(dns.resolve(hostname, rrtype));
    }
  },

  resolve4(hostname, options) {
    return translateErrorCode(dns.resolve(hostname, "A").then(promisifyResolveX(options?.ttl)));
  },

  resolve6(hostname, options) {
    return translateErrorCode(dns.resolve(hostname, "AAAA").then(promisifyResolveX(options?.ttl)));
  },

  resolveAny(hostname) {
    return translateErrorCode(
      new Promise((resolve, reject) => {
        InternalResolver.prototype.resolveAny(hostname, (err, results) => {
          if (results) {
            resolve(results);
          } else {
            reject(err);
          }
        });
      }),
    );
  },
  resolveSrv(hostname) {
    return translateErrorCode(dns.resolveSrv(hostname));
  },
  resolveTxt(hostname) {
    return translateErrorCode(dns.resolveTxt(hostname));
  },
  resolveSoa(hostname) {
    return translateErrorCode(dns.resolveSoa(hostname));
  },
  resolveNaptr(hostname) {
    return translateErrorCode(dns.resolveNaptr(hostname));
  },
  resolveMx(hostname) {
    return translateErrorCode(dns.resolveMx(hostname));
  },
  resolveCaa(hostname) {
    return translateErrorCode(dns.resolveCaa(hostname));
  },
  resolveNs(hostname) {
    return translateErrorCode(dns.resolveNs(hostname));
  },
  resolvePtr(hostname) {
    return translateErrorCode(dns.resolvePtr(hostname));
  },
  resolveCname(hostname) {
    return translateErrorCode(dns.resolveCname(hostname));
  },
  reverse(ip) {
    return translateErrorCode(dns.reverse(ip));
  },

  Resolver: class Resolver {
    #resolver;

    constructor(options) {
      this.#resolver = dns.newResolver();
    }

    cancel() {}

    static #getResolver(object) {
      return #resolver in object ? object.#resolver : dns;
    }

    getServers() {
      return Resolver.#getResolver(this).getServers();
    }

    resolve(hostname, rrtype) {
      if (typeof rrtype !== "string") {
        rrtype = null;
      }
      switch (rrtype?.toLowerCase()) {
        case "a":
        case "aaaa":
          return translateErrorCode(Resolver.#getResolver(this).resolve(hostname, rrtype).then(promisifyLookup));
        default:
          return translateErrorCode(Resolver.#getResolver(this).resolve(hostname, rrtype));
      }
    }

    resolve4(hostname, options) {
      return translateErrorCode(
        Resolver.#getResolver(this).resolve(hostname, "A").then(promisifyResolveX(options?.ttl)),
      );
    }

    resolve6(hostname, options) {
      return translateErrorCode(
        Resolver.#getResolver(this).resolve(hostname, "AAAA").then(promisifyResolveX(options?.ttl)),
      );
    }

    resolveCname(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolveCname(hostname));
    }

    resolveMx(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolveMx(hostname));
    }

    resolveNaptr(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolveNaptr(hostname));
    }

    resolveNs(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolveNs(hostname));
    }

    resolvePtr(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolvePtr(hostname));
    }

    resolveSoa(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolveSoa(hostname));
    }

    resolveSrv(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolveSrv(hostname));
    }

    resolveCaa(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolveCaa(hostname));
    }

    resolveTxt(hostname) {
      return translateErrorCode(Resolver.#getResolver(this).resolveTxt(hostname));
    }

    reverse(ip) {
      return translateErrorCode(Resolver.#getResolver(this).reverse(ip));
    }

    setServers(servers) {
      return setServersOn(servers, Resolver.#getResolver(this));
    }
  },
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
  // these are wrong
  ADDRCONFIG: dns.ADDRCONFIG,
  ALL: dns.ALL,
  V4MAPPED: dns.V4MAPPED,

  // ERROR CODES
  NODATA: "DNS_ENODATA",
  FORMERR: "DNS_EFORMERR",
  SERVFAIL: "DNS_ESERVFAIL",
  NOTFOUND: "DNS_ENOTFOUND",
  NOTIMP: "DNS_ENOTIMP",
  REFUSED: "DNS_EREFUSED",
  BADQUERY: "DNS_EBADQUERY",
  BADNAME: "DNS_EBADNAME",
  BADFAMILY: "DNS_EBADFAMILY",
  BADRESP: "DNS_EBADRESP",
  CONNREFUSED: "DNS_ECONNREFUSED",
  TIMEOUT: "DNS_ETIMEOUT",
  EOF: "DNS_EOF",
  FILE: "DNS_EFILE",
  NOMEM: "DNS_ENOMEM",
  DESTRUCTION: "DNS_EDESTRUCTION",
  BADSTR: "DNS_EBADSTR",
  BADFLAGS: "DNS_EBADFLAGS",
  NONAME: "DNS_ENONAME",
  BADHINTS: "DNS_EBADHINTS",
  NOTINITIALIZED: "DNS_ENOTINITIALIZED",
  LOADIPHLPAPI: "DNS_ELOADIPHLPAPI",
  ADDRGETNETWORKPARAMS: "DNS_EADDRGETNETWORKPARAMS",
  CANCELLED: "DNS_ECANCELLED",

  lookup,
  lookupService,
  Resolver,
  setServers,
  setDefaultResultOrder,
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
