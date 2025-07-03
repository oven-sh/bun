import { define } from "../../codegen/class-definitions";

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
  define({
    name: "Crypto",
    construct: true,
    finalize: false,

    proto: {
      getRandomValues: {
        fn: "getRandomValues",
        // https://discord.com/channels/876711213126520882/1276103693665828894/1276133319033229363
        // https://discord.com/channels/876711213126520882/1276103693665828894/1276127092047609919
        // DOMJIT: {
        //   returns: "JSValue",
        //   "pure": false,
        //   args: ["JSUint8Array"],
        // },
      },
      randomUUID: {
        fn: "randomUUID",
        length: 1,
        DOMJIT: {
          returns: "JSString",
          "pure": false,
          args: [],
        },
      },
      timingSafeEqual: {
        fn: "timingSafeEqual",
        DOMJIT: {
          returns: "JSValue",
          "pure": false,
          args: ["JSUint8Array", "JSUint8Array"],
        },
        length: 2,
      },
    },
    klass: {},
  }),
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
