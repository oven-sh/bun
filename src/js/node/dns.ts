// Hardcoded module "node:dns"
// https://github.com/nodejs/node/blob/v26.12.1/lib/dns.js
const {
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
} = require("internal/dns");
const { isIP } = require("internal/net/isIP");
const { kCustomPromisifyArgsSymbol } = require("internal/shared");
const {
  validateFunction,
  validatePort,
  validateString,
  validateStringWithoutNullBytes,
} = require("internal/validators");

type Callback = (err: Error | null, result?: any, second?: any) => void;

function lookup(hostname: string | null | undefined, options?: unknown, callback?: Callback) {
  if (hostname) validateStringWithoutNullBytes(hostname, "hostname");

  if (typeof options === "function") {
    callback = options as Callback;
    options = undefined;
  } else if (options === undefined || typeof options === "number" || typeof options === "object") {
    validateFunction(callback, "callback");
  } else {
    validateFunction(arguments.length === 2 ? options : callback, "callback");
  }
  const parsed = parseLookupOptions(options);

  let matchedFamily: number;
  if (!hostname) {
    emitInvalidHostnameWarning(hostname);
    if (parsed.all) {
      process.nextTick(callback!, null, []);
    } else {
      process.nextTick(callback!, null, null, parsed.family === 6 ? 6 : 4);
    }
  } else if ((matchedFamily = isIP(hostname)) === 0) {
    try {
      return startLookup(hostname, parsed, callback!);
    } catch (err) {
      if (!(err instanceof DNSException)) throw err;
      process.nextTick(callback!, err);
    }
  } else if (parsed.all) {
    process.nextTick(callback!, null, [{ address: hostname, family: matchedFamily }]);
  } else {
    process.nextTick(callback!, null, hostname, matchedFamily);
  }
  return {};
}

function lookupService(address: string, port: number | string, callback: Callback) {
  if (arguments.length !== 3) throw $ERR_MISSING_ARGS("address", "port", "callback");

  validateString(address, "address");
  if (isIP(address) === 0) throw $ERR_INVALID_ARG_VALUE("address", address);
  validatePort(port);
  validateFunction(callback, "callback");

  // Coerce -0 to +0.
  return startLookupService(address, +port + 0, callback);
}

Object.defineProperty(lookup, kCustomPromisifyArgsSymbol, { __proto__: null, value: ["address", "family"] });
Object.defineProperty(lookupService, kCustomPromisifyArgsSymbol, { __proto__: null, value: ["hostname", "service"] });

const { Resolver, prototype, resolveMap } = createResolverClass(
  bindingName =>
    function query(name, /* options, */ callback) {
      let options;
      if (arguments.length > 2) {
        options = callback;
        callback = arguments[2];
      }

      validateStringWithoutNullBytes(name, "name");
      validateFunction(callback, "callback");

      return startQuery(this, bindingName, name, !!options?.ttl, callback);
    },
);

prototype.resolve = function resolve(hostname, rrtype, callback) {
  let resolver;
  if (typeof rrtype === "string") {
    resolver = resolveMap[rrtype];
  } else if (typeof rrtype === "function") {
    resolver = resolveMap.A;
    callback = rrtype;
  } else {
    throw $ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
  }

  if (resolver === undefined) throw $ERR_INVALID_ARG_VALUE("rrtype", rrtype);
  return resolver.$call(this, hostname, callback);
};

export default {
  lookup,
  lookupService,

  Resolver,
  getDefaultResultOrder,
  setDefaultResultOrder,
  setServers: defaultResolverSetServers,

  // uv_getaddrinfo flags
  ADDRCONFIG: cares.AI_ADDRCONFIG,
  ALL: cares.AI_ALL,
  V4MAPPED: cares.AI_V4MAPPED,

  ...errorCodes,
  ...bindDefaultResolver(prototype),

  get promises() {
    return require("node:dns/promises");
  },
};
