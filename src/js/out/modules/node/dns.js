var lookup = function(domain, options, callback) {
  if (typeof options == "function")
    callback = options;
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  if (typeof options == "number")
    options = { family: options };
  dns.lookup(domain, options).then((res) => {
    if (res.sort((a, b) => a.family - b.family), options?.all)
      callback(null, res.map(mapLookupAll));
    else {
      const [{ address, family }] = res;
      callback(null, address, family);
    }
  }, (error) => {
    callback(error);
  });
}, resolveSrv = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolveSrv(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, resolveTxt = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolveTxt(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, resolveSoa = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolveSoa(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, resolveNaptr = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolveNaptr(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, resolveMx = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolveMx(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, resolveCaa = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolveCaa(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, resolveNs = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolveNs(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, resolvePtr = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolvePtr(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, resolveCname = function(hostname, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolveCname(hostname, callback).then((results) => {
    callback(null, results);
  }, (error) => {
    callback(error);
  });
}, lookupService = function(address, port, callback) {
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  callback(null, address, port);
}, resolve = function(hostname, rrtype, callback) {
  if (typeof rrtype == "function")
    callback = rrtype;
  if (typeof callback != "function")
    throw new TypeError("callback must be a function");
  dns.resolve(hostname).then((results) => {
    switch (rrtype?.toLowerCase()) {
      case "a":
      case "aaaa":
        callback(null, hostname, results.map(({ address }) => address));
        break;
      default:
        callback(null, results);
        break;
    }
  }, (error) => {
    callback(error);
  });
}, Resolver = function(options) {
  return new InternalResolver(options);
}, setDefaultResultOrder = function() {
}, setServers = function() {
}, { dns } = globalThis.Bun, InternalResolver = class Resolver2 {
  constructor(options) {
  }
  cancel() {
  }
  getServers() {
    return [];
  }
  resolve(hostname, rrtype, callback) {
    if (typeof rrtype == "function")
      callback = rrtype, rrtype = null;
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolve(hostname).then((results) => {
      switch (rrtype?.toLowerCase()) {
        case "a":
        case "aaaa":
          callback(null, hostname, results.map(mapResolveX));
          break;
        default:
          callback(null, results);
          break;
      }
    }, (error) => {
      callback(error);
    });
  }
  resolve4(hostname, options, callback) {
    if (typeof options == "function")
      callback = options, options = null;
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.lookup(hostname, { family: 4 }).then((addresses) => {
      callback(null, options?.ttl ? addresses : addresses.map(mapResolveX));
    }, (error) => {
      callback(error);
    });
  }
  resolve6(hostname, options, callback) {
    if (typeof options == "function")
      callback = options, options = null;
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.lookup(hostname, { family: 6 }).then((addresses) => {
      callback(null, options?.ttl ? addresses : addresses.map(({ address }) => address));
    }, (error) => {
      callback(error);
    });
  }
  resolveAny(hostname, callback) {
    callback(null, []);
  }
  resolveCname(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolveCname(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  resolveMx(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolveMx(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  resolveNaptr(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolveNaptr(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  resolveNs(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolveNs(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  resolvePtr(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolvePtr(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  resolveSrv(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolveSrv(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  resolveCaa(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolveCaa(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  resolveTxt(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolveTxt(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  resolveSoa(hostname, callback) {
    if (typeof callback != "function")
      throw new TypeError("callback must be a function");
    dns.resolveSoa(hostname, callback).then((results) => {
      callback(null, results);
    }, (error) => {
      callback(error);
    });
  }
  reverse(ip, callback) {
    callback(null, []);
  }
  setServers(servers) {
  }
};
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
  resolveTxt
} = InternalResolver.prototype, promisifyLookup = (res) => {
  res.sort((a, b) => a.family - b.family);
  const [{ address, family }] = res;
  return { address, family };
}, mapLookupAll = (res) => {
  const { address, family } = res;
  return { address, family };
}, promisifyLookupAll = (res) => {
  return res.sort((a, b) => a.family - b.family), res.map(mapLookupAll);
}, mapResolveX = (a) => a.address, promisifyResolveX = (res) => {
  return res?.map(mapResolveX);
}, promises = {
  lookup(domain, options) {
    if (options?.all)
      return dns.lookup(domain, options).then(promisifyLookupAll);
    return dns.lookup(domain, options).then(promisifyLookup);
  },
  lookupService(address, port) {
    return Promise.resolve([]);
  },
  resolve(hostname, rrtype) {
    if (typeof rrtype !== "string")
      rrtype = null;
    switch (rrtype?.toLowerCase()) {
      case "a":
      case "aaaa":
        return dns.resolve(hostname, rrtype).then(promisifyLookup);
      default:
        return dns.resolve(hostname, rrtype);
    }
  },
  resolve4(hostname, options) {
    if (options?.ttl)
      return dns.lookup(hostname, { family: 4 });
    return dns.lookup(hostname, { family: 4 }).then(promisifyResolveX);
  },
  resolve6(hostname, options) {
    if (options?.ttl)
      return dns.lookup(hostname, { family: 6 });
    return dns.lookup(hostname, { family: 6 }).then(promisifyResolveX);
  },
  resolveSrv(hostname) {
    return dns.resolveSrv(hostname);
  },
  resolveTxt(hostname) {
    return dns.resolveTxt(hostname);
  },
  resolveSoa(hostname) {
    return dns.resolveSoa(hostname);
  },
  resolveNaptr(hostname) {
    return dns.resolveNaptr(hostname);
  },
  resolveMx(hostname) {
    return dns.resolveMx(hostname);
  },
  resolveCaa(hostname) {
    return dns.resolveCaa(hostname);
  },
  resolveNs(hostname) {
    return dns.resolveNs(hostname);
  },
  resolvePtr(hostname) {
    return dns.resolvePtr(hostname);
  },
  resolveCname(hostname) {
    return dns.resolveCname(hostname);
  },
  Resolver: class Resolver3 {
    constructor(options) {
    }
    cancel() {
    }
    getServers() {
      return [];
    }
    resolve(hostname, rrtype) {
      if (typeof rrtype !== "string")
        rrtype = null;
      switch (rrtype?.toLowerCase()) {
        case "a":
        case "aaaa":
          return dns.resolve(hostname, rrtype).then(promisifyLookup);
        default:
          return dns.resolve(hostname, rrtype);
      }
    }
    resolve4(hostname, options) {
      if (options?.ttl)
        return dns.lookup(hostname, { family: 4 });
      return dns.lookup(hostname, { family: 4 }).then(promisifyResolveX);
    }
    resolve6(hostname, options) {
      if (options?.ttl)
        return dns.lookup(hostname, { family: 6 });
      return dns.lookup(hostname, { family: 6 }).then(promisifyResolveX);
    }
    resolveAny(hostname) {
      return Promise.resolve([]);
    }
    resolveCname(hostname) {
      return dns.resolveCname(hostname);
    }
    resolveMx(hostname) {
      return dns.resolveMx(hostname);
    }
    resolveNaptr(hostname) {
      return dns.resolveNaptr(hostname);
    }
    resolveNs(hostname) {
      return dns.resolveNs(hostname);
    }
    resolvePtr(hostname) {
      return dns.resolvePtr(hostname);
    }
    resolveSoa(hostname) {
      return dns.resolveSoa(hostname);
    }
    resolveSrv(hostname) {
      return dns.resolveSrv(hostname);
    }
    resolveCaa(hostname) {
      return dns.resolveCaa(hostname);
    }
    resolveTxt(hostname) {
      return dns.resolveTxt(hostname);
    }
    reverse(ip) {
      return Promise.resolve([]);
    }
    setServers(servers) {
    }
  }
};
for (let key of ["resolveAny", "reverse"])
  promises[key] = () => Promise.resolve(void 0);
var exports = {
  ADDRCONFIG: 0,
  ALL: 1,
  V4MAPPED: 2,
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
  EOF: "DNS_EEOF",
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
  [Symbol.for("CommonJS")]: 0
}, dns_default = exports, {
  ADDRCONFIG,
  ALL,
  V4MAPPED,
  NODATA,
  FORMERR,
  SERVFAIL,
  NOTFOUND,
  NOTIMP,
  REFUSED,
  BADQUERY,
  BADNAME,
  BADFAMILY,
  BADRESP,
  CONNREFUSED,
  TIMEOUT,
  EOF,
  FILE,
  NOMEM,
  DESTRUCTION,
  BADSTR,
  BADFLAGS,
  NONAME,
  BADHINTS,
  NOTINITIALIZED,
  LOADIPHLPAPI,
  ADDRGETNETWORKPARAMS,
  CANCELLED
} = exports;
export {
  setServers,
  setDefaultResultOrder,
  reverse,
  resolveTxt,
  resolveSrv,
  resolveSoa,
  resolvePtr,
  resolveNs,
  resolveNaptr,
  resolveMx,
  resolveCname,
  resolveCaa,
  resolveAny,
  resolve6,
  resolve4,
  resolve,
  promises,
  lookupService,
  lookup,
  dns_default as default,
  V4MAPPED,
  TIMEOUT,
  SERVFAIL,
  Resolver,
  REFUSED,
  NOTINITIALIZED,
  NOTIMP,
  NOTFOUND,
  NONAME,
  NOMEM,
  NODATA,
  LOADIPHLPAPI,
  FORMERR,
  FILE,
  EOF,
  DESTRUCTION,
  CONNREFUSED,
  CANCELLED,
  BADSTR,
  BADRESP,
  BADQUERY,
  BADNAME,
  BADHINTS,
  BADFLAGS,
  BADFAMILY,
  ALL,
  ADDRGETNETWORKPARAMS,
  ADDRCONFIG
};
