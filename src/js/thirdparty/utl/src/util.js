const ALL_PROPERTIES = 0;
const ONLY_ENUMERABLE = 2;
const kPending = Symbol('kPending');
const kRejected = Symbol('kRejected');

function getOwnNonIndexProperties(a, filter = ONLY_ENUMERABLE) {
  const desc = Object.getOwnPropertyDescriptors(a);
  const ret = [];
  for (const [k, v] of Object.entries(desc)) {
    if (!/^(0|[1-9][0-9]*)$/.test(k) ||
        (parseInt(k, 10) >= (2 ** 32 - 1))) { // Arrays are limited in size
      if ((filter === ONLY_ENUMERABLE) && !v.enumerable) {
        continue;
      }
      ret.push(k);
    }
  }
  for (const s of Object.getOwnPropertySymbols(a)) {
    const v = Object.getOwnPropertyDescriptor(a, s);
    if ((filter === ONLY_ENUMERABLE) && !v.enumerable) {
      continue;
    }
    ret.push(s);
  }
  return ret;
}

export default {
  constants: {
    kPending,
    kRejected,
    ALL_PROPERTIES,
    ONLY_ENUMERABLE,
  },
  getOwnNonIndexProperties,
  getPromiseDetails() { return [kPending, undefined]; }, // TODO
  getProxyDetails(proxy, withHandler = true) {
    const isProxy = $isProxyObject(proxy);
    if (!isProxy) return undefined;
    const handler = $getProxyInternalField(proxy, $proxyFieldHandler);
    // if handler is null, the proxy is revoked
    const target = handler === null ? null : $getProxyInternalField(proxy, $proxyFieldTarget);
    if (withHandler) return [target, handler];
    else return target;
  },
  previewEntries(val) {
    return [[], false]; // TODO
  },
  getConstructorName(val) {
    if (!val || typeof val !== 'object') {
      throw new Error('Invalid object');
    }
    if (val.constructor && val.constructor.name) {
      return val.constructor.name;
    }
    const str = Object.prototype.toString.call(val);
    // e.g. [object Boolean]
    const m = str.match(/^\[object ([^\]]+)\]/);
    if (m) {
      return m[1];
    }
    return 'Object';
  },
  getExternalValue() { return BigInt(0); },
};
