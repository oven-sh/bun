// only resolve4, resolve, lookup, and resolve6 are implemented.

const { dns } = globalThis.Bun;

function lookup(domain, options, callback) {
  if (typeof options == "function") {
    callback = options;
  }

  if (typeof callback != "function") {
    throw new TypeError("callback must be a function");
  }

  if (typeof options == "number") {
    options = { family: options };
  }

  dns.lookup(domain, options).then(
    ([{ address, family }]) => {
      callback(null, address, family);
    },
    (error) => {
      callback(error);
    },
  );
}

function lookupService(address, port, callback) {
  if (typeof callback != "function") {
    throw new TypeError("callback must be a function");
  }

  callback(null, address, port);
}

var InternalResolver = class Resolver {
  constructor(options) {}

  cancel() {}

  getServers() {
    return [];
  }

  resolve(hostname, rrtype, callback) {
    if (typeof rrtype == "function") {
      callback = rrtype;
    }

    if (typeof callback != "function") {
      throw new TypeError("callback must be a function");
    }

    dns.lookup(hostname).then(
      (addresses) => {
        callback(
          null,
          hostname,
          addresses.map(({ address }) => address),
        );
      },
      (error) => {
        callback(error);
      },
    );
  }

  resolve4(hostname, options, callback) {
    if (typeof options == "function") {
      callback = options;
    }

    if (typeof callback != "function") {
      throw new TypeError("callback must be a function");
    }

    dns.lookup(hostname, { family: 4 }).then(
      (addresses) => {
        callback(
          null,
          addresses.map(({ address }) => address),
        );
      },
      (error) => {
        callback(error);
      },
    );
  }

  resolve6(hostname, options, callback) {
    if (typeof options == "function") {
      callback = options;
    }

    if (typeof callback != "function") {
      throw new TypeError("callback must be a function");
    }

    dns.lookup(hostname, { family: 6 }).then(
      (addresses) => {
        callback(
          null,
          addresses.map(({ address }) => address),
        );
      },
      (error) => {
        callback(error);
      },
    );
  }

  resolveAny(hostname, callback) {
    callback(null, []);
  }

  resolveCname(hostname, callback) {
    callback(null, []);
  }

  resolveMx(hostname, callback) {
    callback(null, []);
  }

  resolveNaptr(hostname, callback) {
    callback(null, []);
  }

  resolveNs(hostname, callback) {
    callback(null, []);
  }

  resolvePtr(hostname, callback) {
    callback(null, []);
  }

  resolveSoa(hostname, callback) {
    callback(null, []);
  }

  resolveSrv(hostname, callback) {
    callback(null, []);
  }

  resolveCaa(hostname, callback) {
    callback(null, []);
  }

  resolveTxt(hostname, callback) {
    callback(null, []);
  }

  reverse(ip, callback) {
    callback(null, []);
  }

  setServers(servers) {}
};

function Resolver(options) {
  return new InternalResolver(options);
}
Object.setPrototypeOf(Resolver.prototype, InternalResolver.prototype);
Object.setPrototypeOf(Resolver, InternalResolver);

export var {
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
function setServers() {}

const promisifyLookup = (res) => {
  const [{ address, family }] = res;
  return { address, family };
};

// promisified versions
export const promises = {
  lookup(domain, options) {
    return dns.lookup(domain, options).then(promisifyLookup);
  },

  lookupService(address, port) {
    return Promise.resolve([]);
  },

  resolve(hostname, rrtype) {
    return dns.lookup(hostname);
  },

  resolve4(hostname, options) {
    return dns.lookup(hostname, { family: 4 });
  },

  resolve6(hostname, options) {
    return dns.lookup(hostname, { family: 6 });
  },

  Resolver: class Resolver {
    constructor(options) {}

    cancel() {}

    getServers() {
      return [];
    }

    resolve(hostname, rrtype) {
      return dns.lookup(hostname);
    }

    resolve4(hostname, options) {
      return dns.lookup(hostname, { family: 4 });
    }

    resolve6(hostname, options) {
      return dns.lookup(hostname, { family: 6 });
    }

    resolveAny(hostname) {
      return Promise.resolve([]);
    }

    resolveCname(hostname) {
      return Promise.resolve([]);
    }

    resolveMx(hostname) {
      return Promise.resolve([]);
    }

    resolveNaptr(hostname) {
      return Promise.resolve([]);
    }

    resolveNs(hostname) {
      return Promise.resolve([]);
    }

    resolvePtr(hostname) {
      return Promise.resolve([]);
    }

    resolveSoa(hostname) {
      return Promise.resolve([]);
    }

    resolveSrv(hostname) {
      return Promise.resolve([]);
    }

    resolveCaa(hostname) {
      return Promise.resolve([]);
    }

    resolveTxt(hostname) {
      return Promise.resolve([]);
    }

    reverse(ip) {
      return Promise.resolve([]);
    }

    setServers(servers) {}
  },
};
for (const key of [
  "resolveAny",
  "resolveCname",
  "resolveCaa",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
]) {
  promises[key] = () => Promise.resolve(undefined);
}

const exports = {
  // these are wrong
  ADDRCONFIG: 0,
  ALL: 1,
  V4MAPPED: 2,

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
  resolveTxt,
  promises,
  [Symbol.for("CommonJS")]: 0,
};
export default exports;
export const {
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
  CANCELLED,
} = exports;
export { lookup, lookupService, Resolver, setServers, setDefaultResultOrder };
