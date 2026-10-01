// Hardcoded module "node:quic"
// Ported from Node.js lib/quic.js (v26.3.0).
const {
  connect,
  listen,
  QuicEndpoint,
  QuicError,
  QuicSession,
  QuicStream,
  CC_ALGO_RENO,
  CC_ALGO_CUBIC,
  CC_ALGO_BBR,
  DEFAULT_CIPHERS,
  DEFAULT_GROUPS,
} = require("internal/quic/quic");

process.emitWarning("quic is an experimental feature and might change at any time", "ExperimentalWarning");

function getEnumerableConstant(value) {
  return {
    __proto__: null,
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  };
}

const cc = Object.seal(
  Object.create(null, {
    RENO: getEnumerableConstant(CC_ALGO_RENO),
    CUBIC: getEnumerableConstant(CC_ALGO_CUBIC),
    BBR: getEnumerableConstant(CC_ALGO_BBR),
  }),
);

const constants = Object.seal(
  Object.create(null, {
    cc: getEnumerableConstant(cc),
    DEFAULT_CIPHERS: getEnumerableConstant(DEFAULT_CIPHERS),
    DEFAULT_GROUPS: getEnumerableConstant(DEFAULT_GROUPS),
  }),
);

export default Object.seal(
  Object.create(null, {
    connect: getEnumerableConstant(connect),
    listen: getEnumerableConstant(listen),
    QuicEndpoint: getEnumerableConstant(QuicEndpoint),
    QuicError: getEnumerableConstant(QuicError),
    QuicSession: getEnumerableConstant(QuicSession),
    QuicStream: getEnumerableConstant(QuicStream),
    constants: getEnumerableConstant(constants),
  }),
);
