import { define } from "../scripts/class-definitions";

const names = ["SHA1", "MD5", "MD4", "SHA224", "SHA512", "SHA384", "SHA256", "SHA512_256"];
const named = names.map(name => {
  return define({
    name: name,
    construct: true,
    finalize: true,
    configurable: false,
    klass: {
      hash: {
        fn: "hash",
        length: 2,
      },
      byteLength: {
        getter: "getByteLengthStatic",
      },
    },
    JSType: "0b11101110",
    proto: {
      digest: {
        fn: "digest",
        length: 0,
      },
      update: {
        fn: "update",
        length: 1,
      },
      byteLength: {
        getter: "getByteLength",
      },
    },
  });
});

export default [
  ...named,
  define({
    name: "CryptoHasher",
    construct: true,
    finalize: true,
    klass: {
      hash: {
        fn: "hash",
        length: 2,
      },
      algorithms: {
        getter: "getAlgorithms",
        cache: true,
      },
    },
    JSType: "0b11101110",
    proto: {
      digest: {
        fn: "digest",
        length: 0,
      },
      algorithm: {
        getter: "getAlgorithm",
        cache: true,
      },
      update: {
        fn: "update",
        length: 2,
      },
      copy: {
        fn: "copy",
        length: 0,
      },
      byteLength: {
        getter: "getByteLength",
      },
    },
  }),
];
