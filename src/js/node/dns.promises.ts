// Hardcoded module "node:dns/promises"
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/dns/promises.js
const {
  bindDefaultResolver,
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
const { validatePort, validateString, validateStringWithoutNullBytes } = require("internal/validators");

type DNSRequest = ThisParameterType<Parameters<typeof startLookup>[2]>;

function settle(this: DNSRequest, err: Error | null, result: unknown) {
  if (err) {
    this.reject(err);
  } else {
    this.resolve(result);
  }
}

function settleLookup(this: DNSRequest, err: Error | null, address: string, family: number) {
  settle.$call(this, err, { address, family });
}

function settleLookupService(this: DNSRequest, err: Error | null, hostname: string, service: string) {
  settle.$call(this, err, { hostname, service });
}

function lookup(hostname: string | null | undefined, options?: unknown) {
  if (hostname) validateStringWithoutNullBytes(hostname, "hostname");
  const parsed = parseLookupOptions(options);

  if (!hostname) {
    emitInvalidHostnameWarning(hostname);
    return Promise.$resolve(parsed.all ? [] : { address: null, family: parsed.family === 6 ? 6 : 4 });
  }

  const matchedFamily = isIP(hostname);
  if (matchedFamily !== 0) {
    const result = { address: hostname, family: matchedFamily };
    return Promise.$resolve(parsed.all ? [result] : result);
  }

  const promise = $newPromise();
  try {
    startLookup(hostname, parsed, parsed.all ? settle : settleLookup, promise);
  } catch (err) {
    $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
  }
  return promise;
}

function lookupService(address: string, port: number | string) {
  if (arguments.length !== 2) throw $ERR_MISSING_ARGS("address", "port");

  validateString(address, "address");
  if (isIP(address) === 0) throw $ERR_INVALID_ARG_VALUE("address", address);
  validatePort(port);

  const promise = $newPromise();
  try {
    // Coerce -0 to +0.
    startLookupService(address, +port + 0, settleLookupService, promise);
  } catch (err) {
    $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
  }
  return promise;
}

const { Resolver, prototype, resolveMap } = createResolverClass(
  bindingName =>
    function query(name, options) {
      validateStringWithoutNullBytes(name, "name");

      const ttl = !!options?.ttl;
      const promise = $newPromise();
      try {
        startQuery(this, bindingName, name, ttl, settle, promise);
      } catch (err) {
        $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, err);
      }
      return promise;
    },
);

prototype.resolve = function resolve(hostname, rrtype) {
  let resolver = resolveMap.A;
  if (rrtype !== undefined) {
    validateString(rrtype, "rrtype");
    resolver = resolveMap[rrtype];
  }

  if (resolver === undefined) throw $ERR_INVALID_ARG_VALUE("rrtype", rrtype);
  return resolver.$call(this, hostname);
};

export default {
  lookup,
  lookupService,
  Resolver,
  getDefaultResultOrder,
  setDefaultResultOrder,
  setServers: defaultResolverSetServers,

  ...errorCodes,
  ...bindDefaultResolver(prototype),
};
