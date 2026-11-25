// What "node:dns" and "node:dns/promises" share.
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/dns/utils.js
const { isIP } = require("internal/net/isIP");
const { hasObserver, startPerf, stopPerf } = require("internal/shared");
const {
  validateArray,
  validateBoolean,
  validateInt32,
  validateNumber,
  validateOneOf,
  validatePort,
  validateString,
  validateUint32,
} = require("internal/validators");

const ArrayPrototypeForEach = Array.prototype.forEach;
const ArrayPrototypePush = Array.prototype.push;
const FunctionPrototypeBind = Function.prototype.bind;
const NumberParseInt = Number.parseInt;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeIncludes = String.prototype.includes;

const internalErrorName: (err: number) => string = $bindgen("node_util_binding.bind.ts", "internalErrorName");
const getRuntimeDefaultResultOrderOption = $bindgen("dns_internals.bind.ts", "getRuntimeDefaultResultOrderOption");
const globalChannel = $bindgen("dns_internals.bind.ts", "globalChannel");
const preferAsyncStack = $bindgen("dns_internals.bind.ts", "preferAsyncStack");

type Callback = (this: ReqWrap, err: Error | null, result?: any, second?: any) => void;
type Query = (this: ResolverBase, name: string, ...args: any[]) => unknown;
type QueryName = keyof $Bindgen.ChannelWrap & (`query${string}` | "getHostByAddr");
type ServerTriple = [family: number, address: string, port: number];
interface LookupOptions {
  family: number;
  hints: number;
  all: boolean;
  order: string;
}

const kPerfHooksContext = Symbol("kPerfHooksDnsContext");

class ReqWrap {
  declare callback: Callback;
  declare hostname: string;
  declare oncomplete: (err: any, result: any, second: any) => void;
  /** If "node:dns/promises" asked. */
  declare promise?: Promise<unknown>;

  resolve(value: unknown) {
    const { promise } = this;
    if ($isPromise(promise)) $resolvePromiseWithFirstResolvingFunctionCallCheck(promise, value);
  }

  reject(err: Error) {
    const { promise } = this;
    if (!$isPromise(promise)) return;
    preferAsyncStack(err, promise);
    $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
  }
}
class GetAddrInfoReqWrap extends ReqWrap {
  declare family: number;
}
class GetNameInfoReqWrap extends ReqWrap {
  declare port: number;
}
class QueryReqWrap extends ReqWrap {
  declare bindingName: QueryName;
  declare ttl: boolean;
}

const { ADDRCONFIG: AI_ADDRCONFIG, ALL: AI_ALL, V4MAPPED: AI_V4MAPPED } = Bun.dns;
const DNS_ORDER_VERBATIM = 0;
const DNS_ORDER_IPV4_FIRST = 1;
const DNS_ORDER_IPV6_FIRST = 2;

/** `internalBinding("cares_wrap")` */
const cares = {
  getaddrinfo: $bindgen("dns_internals.bind.ts", "getaddrinfo"),
  getnameinfo: $bindgen("dns_internals.bind.ts", "getnameinfo"),
  canonicalizeIP: $bindgen("answer_jsc.bind.ts", "canonicalizeIP"),
  AI_ADDRCONFIG,
  AI_ALL,
  AI_V4MAPPED,
  DNS_ORDER_VERBATIM,
  DNS_ORDER_IPV4_FIRST,
  DNS_ORDER_IPV6_FIRST,
  GetAddrInfoReqWrap,
  GetNameInfoReqWrap,
  QueryReqWrap,
  get ChannelWrap() {
    return $bindgen("dns_internals.bind.ts", "ChannelWrap");
  },
};

const UV_EAI_NODATA = -3007;
const UV_EAI_NONAME = -3008;

// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/errors.js#L805-L844
class DNSException extends Error {
  errno: number | undefined;
  declare syscall: string;
  declare hostname?: string;

  constructor(code: number | string, syscall: string, hostname?: string) {
    let errno: number | undefined;
    if (typeof code === "number") {
      errno = code;
      code = code === UV_EAI_NODATA || code === UV_EAI_NONAME ? "ENOTFOUND" : internalErrorName(code);
    }
    super(`${syscall} ${code}${hostname ? ` ${hostname}` : ""}`);
    this.errno = errno;
    this.code = code;
    this.syscall = syscall;
    if (hostname) this.hostname = hostname;
  }

  get ["constructor"]() {
    return Error;
  }
}

function validateStringWithoutNullBytes(value: string, name: string) {
  validateString(value, name);
  if (StringPrototypeIncludes.$call(value, "\0")) {
    throw $ERR_INVALID_ARG_VALUE(name, value, "must be a string without null bytes");
  }
}

const IANA_DNS_PORT = 53;
const IPv6RE = /^\[([^[\]]*)\]/;
const addrSplitRE = /(^.+?)(?::(\d+))?$/;

function parseServer(server: string): ServerTriple {
  let family = isIP(server);
  if (family !== 0) return [family, server, IANA_DNS_PORT];

  const split = RegExpPrototypeExec.$call(addrSplitRE, server);
  const host = (RegExpPrototypeExec.$call(IPv6RE, server) ?? split)?.[1];
  if (host === undefined || (family = isIP(host)) === 0) throw $ERR_INVALID_IP_ADDRESS(server);

  const port = NumberParseInt(split?.[2] ?? "") || IANA_DNS_PORT;
  validatePort(port);
  return [family, host, port];
}

class ResolverBase {
  _handle: $Bindgen.ChannelWrap;

  constructor(options: { timeout?: number; tries?: number; maxTimeout?: number } | undefined = undefined) {
    const { timeout = -1, tries = 4, maxTimeout = 0 } = { ...options };
    validateInt32(timeout, "options.timeout", -1);
    validateInt32(tries, "options.tries", 1);
    validateUint32(maxTimeout, "options.maxTimeout");
    this._handle = new cares.ChannelWrap(timeout, tries, maxTimeout);
  }

  cancel() {
    this._handle.cancel();
  }

  getServers() {
    return this._handle.getServers() || [];
  }

  setServers(servers: readonly string[]) {
    validateArray(servers, "servers");

    const newSet: ServerTriple[] = [];
    ArrayPrototypeForEach.$call(servers, (server: string, index: number) => {
      validateString(server, `servers[${index}]`);
      ArrayPrototypePush.$call(newSet, parseServer(server));
    });

    if (!this._handle.setServers(newSet)) {
      throw $ERR_DNS_SET_SERVERS_FAILED(
        require("internal/util/inspect").format(
          'c-ares failed to set servers: "There are pending queries." [%s]',
          servers,
        ),
      );
    }
  }

  setLocalAddress(ipv4: string, ipv6?: string) {
    validateStringWithoutNullBytes(ipv4, "ipv4");
    if (ipv6 !== undefined) validateStringWithoutNullBytes(ipv6, "ipv6");
    this._handle.setLocalAddress(ipv4, ipv6);
  }
}

let defaultHandle: $Bindgen.ChannelWrap | undefined;
const defaultResolver = {
  get _handle() {
    return (defaultHandle ??= globalChannel());
  },
};

// Node.js makes a new resolver and binds the exports again, which a function that was read before does not notice.
// Here the servers of the one resolver change, which is also that of `Bun.dns`.
function defaultResolverSetServers(servers: readonly string[]) {
  ResolverBase.prototype.setServers.$call(defaultResolver, servers);
}

function createResolverClass(resolver: (bindingName: QueryName) => Query) {
  function named(bindingName: QueryName) {
    return Object.defineProperty(resolver(bindingName), "name", { __proto__: null, value: bindingName });
  }

  const resolveMap: Record<string, Query | undefined> = { __proto__: null! };
  class Resolver extends ResolverBase {}
  const prototype = Resolver.prototype as Resolver & Record<string, Query>;

  prototype.resolveAny = resolveMap.ANY = named("queryAny");
  prototype.resolve4 = resolveMap.A = named("queryA");
  prototype.resolve6 = resolveMap.AAAA = named("queryAaaa");
  prototype.resolveCaa = resolveMap.CAA = named("queryCaa");
  prototype.resolveCname = resolveMap.CNAME = named("queryCname");
  prototype.resolveMx = resolveMap.MX = named("queryMx");
  prototype.resolveNs = resolveMap.NS = named("queryNs");
  prototype.resolveTlsa = resolveMap.TLSA = named("queryTlsa");
  prototype.resolveTxt = resolveMap.TXT = named("queryTxt");
  prototype.resolveSrv = resolveMap.SRV = named("querySrv");
  prototype.resolvePtr = resolveMap.PTR = named("queryPtr");
  prototype.resolveNaptr = resolveMap.NAPTR = named("queryNaptr");
  prototype.resolveSoa = resolveMap.SOA = named("querySoa");
  prototype.reverse = named("getHostByAddr");

  return { Resolver, prototype, resolveMap };
}

function bindDefaultResolver(source: ReturnType<typeof createResolverClass>["prototype"]) {
  const bind = (method: Function): ((...args: any[]) => any) => FunctionPrototypeBind.$call(method, defaultResolver);
  return {
    getServers: bind(source.getServers),
    resolve: bind(source.resolve),
    resolve4: bind(source.resolve4),
    resolve6: bind(source.resolve6),
    resolveAny: bind(source.resolveAny),
    resolveCaa: bind(source.resolveCaa),
    resolveCname: bind(source.resolveCname),
    resolveMx: bind(source.resolveMx),
    resolveNaptr: bind(source.resolveNaptr),
    resolveNs: bind(source.resolveNs),
    resolvePtr: bind(source.resolvePtr),
    resolveSoa: bind(source.resolveSoa),
    resolveSrv: bind(source.resolveSrv),
    resolveTlsa: bind(source.resolveTlsa),
    resolveTxt: bind(source.resolveTxt),
    reverse: bind(source.reverse),
  };
}

const validDnsOrders = ["verbatim", "ipv4first", "ipv6first"];
const validFamilies = [0, 4, 6];
let dnsOrder: string | undefined;

function setDefaultResultOrder(value: string) {
  validateOneOf(value, "dnsOrder", validDnsOrders);
  dnsOrder = value;
}

function getDefaultResultOrder(): string {
  return (dnsOrder ??= getRuntimeDefaultResultOrderOption());
}

function parseLookupOptions(options: any): LookupOptions {
  let hints = 0;
  let family = 0;
  let all = false;
  let order = getDefaultResultOrder();

  if (typeof options === "number") {
    validateOneOf(options, "family", validFamilies);
    // Coerce -0 to +0.
    family = options + 0;
  } else if (options !== undefined && typeof options !== "object") {
    throw $ERR_INVALID_ARG_TYPE("options", ["integer", "object"], options);
  } else if (options != null) {
    let value;
    if ((value = options.hints) != null) {
      validateNumber(value, "options.hints");
      hints = value >>> 0;
      if ((hints & ~(AI_ADDRCONFIG | AI_ALL | AI_V4MAPPED)) !== 0) {
        throw $ERR_INVALID_ARG_VALUE("hints", hints);
      }
    }
    if ((value = options.family) != null) {
      // Node.js documents the two names for both APIs, and rejects them in the one with promises.
      if (value === "IPv4") {
        family = 4;
      } else if (value === "IPv6") {
        family = 6;
      } else {
        validateOneOf(value, "options.family", validFamilies);
        family = value + 0;
      }
    }
    if ((value = options.all) != null) {
      validateBoolean(value, "options.all");
      all = value;
    }
    if ((value = options.verbatim) != null) {
      validateBoolean(value, "options.verbatim");
      order = value ? "verbatim" : "ipv4first";
    }
    if ((value = options.order) != null) {
      validateOneOf(value, "options.order", validDnsOrders);
      order = value;
    }
  }

  return { family, hints, all, order };
}

let invalidHostnameWarningEmitted = false;

// Node.js 25 throws ERR_INVALID_ARG_VALUE instead. fastify up to 4.28.1 and hot-shots 17 pass no host, so Bun answers as Node.js 24 does.
function emitInvalidHostnameWarning(hostname: unknown) {
  if (invalidHostnameWarningEmitted) return;
  invalidHostnameWarningEmitted = true;
  process.emitWarning(
    `The provided hostname "${String(hostname)}" is not a valid hostname, and is supported in the dns module solely for compatibility.`,
    "DeprecationWarning",
    "DEP0118",
  );
}

function stopObserving(req: ReqWrap, detail: object) {
  if (hasObserver("dns")) stopPerf(req, kPerfHooksContext, { detail });
}

function onlookup(this: GetAddrInfoReqWrap, err: number, addresses: string[]) {
  if (err) return this.callback(new DNSException(err, "getaddrinfo", this.hostname));

  this.callback(null, addresses[0], this.family || isIP(addresses[0]));
  if (this[kPerfHooksContext]) stopObserving(this, { addresses });
}

function onlookupall(this: GetAddrInfoReqWrap, err: number, addresses: any[]) {
  if (err) return this.callback(new DNSException(err, "getaddrinfo", this.hostname));

  const family = this.family;
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    addresses[i] = { address, family: family || isIP(address) };
  }

  this.callback(null, addresses);
  if (this[kPerfHooksContext]) stopObserving(this, { addresses });
}

function onlookupservice(this: GetNameInfoReqWrap, err: number, hostname: string, service: string) {
  if (err) return this.callback(new DNSException(err, "getnameinfo", this.hostname));

  this.callback(null, hostname, service);
  if (this[kPerfHooksContext]) stopObserving(this, { hostname, service });
}

function onresolve(this: QueryReqWrap, err: string | number, result: unknown) {
  if (err) return this.callback(new DNSException(err, this.bindingName, this.hostname));

  this.callback(null, result);
  if (this[kPerfHooksContext]) stopObserving(this, { result });
}

// Each of the three throws if there is nothing to wait for.

function startLookup(hostname: string, options: LookupOptions, callback: Callback, promise?: Promise<unknown>) {
  const { family, hints, order: dnsOrder } = options;
  const req = new GetAddrInfoReqWrap();
  req.callback = callback;
  req.family = family;
  req.hostname = hostname;
  req.oncomplete = options.all ? onlookupall : onlookup;
  if (promise) req.promise = promise;

  const order =
    dnsOrder === "ipv4first"
      ? DNS_ORDER_IPV4_FIRST
      : dnsOrder === "ipv6first"
        ? DNS_ORDER_IPV6_FIRST
        : DNS_ORDER_VERBATIM;

  const err = cares.getaddrinfo(req, hostname, family, hints, order);
  if (err) throw new DNSException(err, "getaddrinfo", hostname);
  if (hasObserver("dns")) {
    const detail = { hostname, family, hints, verbatim: order === DNS_ORDER_VERBATIM, order: dnsOrder };
    startPerf(req, kPerfHooksContext, { type: "dns", name: "lookup", detail });
  }
  return req;
}

function startLookupService(address: string, port: number, callback: Callback, promise?: Promise<unknown>) {
  const req = new GetNameInfoReqWrap();
  req.callback = callback;
  req.hostname = address;
  req.port = port;
  req.oncomplete = onlookupservice;
  if (promise) req.promise = promise;

  const err = cares.getnameinfo(req, address, port);
  if (err) throw new DNSException(err, "getnameinfo", address);
  if (hasObserver("dns")) {
    startPerf(req, kPerfHooksContext, { type: "dns", name: "lookupService", detail: { host: address, port } });
  }
  return req;
}

function startQuery(
  resolver: ResolverBase,
  bindingName: QueryName,
  hostname: string,
  ttl: boolean,
  callback: Callback,
  promise?: Promise<unknown>,
) {
  const req = new QueryReqWrap();
  req.bindingName = bindingName;
  req.callback = callback;
  req.hostname = hostname;
  req.oncomplete = onresolve;
  req.ttl = ttl;
  if (promise) req.promise = promise;

  const err = resolver._handle[bindingName](req, hostname);
  if (err) throw new DNSException(err, bindingName, hostname);
  if (hasObserver("dns")) {
    startPerf(req, kPerfHooksContext, { type: "dns", name: bindingName, detail: { host: hostname, ttl } });
  }
  return req;
}

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

export default {
  DNSException,
  bindDefaultResolver,
  cares,
  createResolverClass,
  defaultResolverSetServers,
  emitInvalidHostnameWarning,
  errorCodes,
  getDefaultResultOrder,
  parseLookupOptions,
  setDefaultResultOrder,
  startLookup,
  startLookupService,
  startQuery,
  validateStringWithoutNullBytes,
};
